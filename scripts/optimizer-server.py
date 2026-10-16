import argparse
import hmac
import json
import math
import os
import secrets
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit

from ortools.constraint_solver import pywrapcp, routing_enums_pb2


def solve_routes(payload):
    names = payload.get('stops')
    matrix = payload.get('minutes')
    demands = payload.get('demands')
    capacities = payload.get('capacities')
    if not isinstance(names, list) or not 2 <= len(names) <= 200:
        raise ValueError('stops에는 센터를 포함한 2~200개의 지점명을 입력하세요.')
    if any(not isinstance(name, str) or not name.strip() or len(name) > 200 for name in names):
        raise ValueError('지점명은 1~200자의 문자열이어야 합니다.')
    count = len(names)
    if not isinstance(matrix, list) or len(matrix) != count:
        raise ValueError('minutes는 지점 수와 같은 크기의 이동시간 행렬이어야 합니다.')
    def valid_number(value):
        return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value) and 0 <= value <= 1_000_000
    if any(not isinstance(row, list) or len(row) != count or any(not valid_number(value) for value in row) for row in matrix):
        raise ValueError('이동시간은 0 이상 1,000,000 이하의 분 단위 숫자여야 합니다.')
    if any(matrix[index][index] != 0 for index in range(count)):
        raise ValueError('같은 지점으로의 이동시간은 0이어야 합니다.')
    def valid_integer(value):
        return isinstance(value, int) and not isinstance(value, bool) and 0 <= value <= 1_000_000
    if not isinstance(demands, list) or len(demands) != count or any(not valid_integer(value) for value in demands) or demands[0] != 0:
        raise ValueError('demands는 지점별 0 이상 정수 물량이며 센터 물량은 0이어야 합니다.')
    if not isinstance(capacities, list) or not 1 <= len(capacities) <= 100 or any(not valid_integer(value) or value == 0 for value in capacities):
        raise ValueError('capacities에는 차량 1~100대의 양수 정수 적재량을 입력하세요.')
    limit = payload.get('seconds', 5)
    if not isinstance(limit, int) or isinstance(limit, bool) or not 1 <= limit <= 30:
        raise ValueError('seconds는 1~30초의 정수여야 합니다.')
    if sum(demands) > sum(capacities) or max(demands) > max(capacities):
        raise ValueError('차량 적재량이 부족합니다. capacities를 늘려 주세요.')
    manager = pywrapcp.RoutingIndexManager(count, len(capacities), 0)
    routing = pywrapcp.RoutingModel(manager)
    durations = [[round(value * 60) for value in row] for row in matrix]
    travel = routing.RegisterTransitCallback(lambda start, end: durations[manager.IndexToNode(start)][manager.IndexToNode(end)])
    routing.SetArcCostEvaluatorOfAllVehicles(travel)
    demand = routing.RegisterUnaryTransitCallback(lambda index: demands[manager.IndexToNode(index)])
    routing.AddDimensionWithVehicleCapacity(demand, 0, capacities, True, 'Capacity')
    parameters = pywrapcp.DefaultRoutingSearchParameters()
    parameters.first_solution_strategy = routing_enums_pb2.FirstSolutionStrategy.PATH_CHEAPEST_ARC
    parameters.local_search_metaheuristic = routing_enums_pb2.LocalSearchMetaheuristic.GUIDED_LOCAL_SEARCH
    parameters.time_limit.seconds = limit
    assignment = routing.SolveWithParameters(parameters)
    if not assignment:
        raise ValueError('조건을 만족하는 배차를 찾지 못했습니다. 적재량과 계산 시간을 확인하세요.')
    routes = []
    for vehicle in range(len(capacities)):
        position = routing.Start(vehicle)
        indexes = [0]
        duration = 0
        while not routing.IsEnd(position):
            next_position = assignment.Value(routing.NextVar(position))
            duration += routing.GetArcCostForVehicle(position, next_position, vehicle)
            position = next_position
            indexes.append(manager.IndexToNode(position))
        if len(indexes) <= 2:
            continue
        routes.append({'vehicle': vehicle + 1, 'stops': [names[index] for index in indexes], 'indexes': indexes,
                       'load': sum(demands[index] for index in indexes), 'capacity': capacities[vehicle], 'minutes': round(duration / 60, 2)})
    return {'routes': routes, 'totalMinutes': round(sum(route['minutes'] for route in routes), 2),
            'note': '센터 출발·복귀, 입력 이동시간과 적재량 기준의 계산 초안입니다. 교통·납품마감·하차시간은 포함하지 않습니다.'}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--port', type=int, default=8765)
    args = parser.parse_args()
    token = secrets.token_urlsafe(32)
    busy = threading.Lock()
    origins = {'https://sajoansan.vercel.app'} | set(filter(None, os.getenv('SAJO_OPTIMIZER_ORIGINS', '').split(',')))

    class Handler(BaseHTTPRequestHandler):
        def origin_allowed(self):
            origin = self.headers.get('Origin', '')
            parts = urlsplit(origin)
            return origin in origins or (parts.scheme == 'http' and parts.hostname in ('127.0.0.1', 'localhost'))

        def send_json(self, status, body):
            encoded = json.dumps(body, ensure_ascii=False).encode('utf-8')
            self.send_response(status)
            if self.origin_allowed():
                self.send_header('Access-Control-Allow-Origin', self.headers.get('Origin'))
                self.send_header('Vary', 'Origin')
                self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
                self.send_header('Access-Control-Allow-Headers', 'Content-Type, X-Optimizer-Token')
                self.send_header('Access-Control-Allow-Private-Network', 'true')
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.send_header('Cache-Control', 'no-store')
            self.send_header('Content-Length', str(len(encoded)))
            self.end_headers()
            self.wfile.write(encoded)

        def do_OPTIONS(self):
            self.send_json(200 if self.origin_allowed() else 403, {})

        def do_GET(self):
            if self.path != '/health':
                self.send_json(404, {'error': 'Not found'})
                return
            self.send_json(200, {'ready': True, 'engine': 'Google OR-Tools'})

        def do_POST(self):
            if self.path != '/solve':
                self.send_json(404, {'error': 'Not found'})
                return
            if not self.origin_allowed() or not hmac.compare_digest(self.headers.get('X-Optimizer-Token', ''), token):
                self.send_json(403, {'error': '실행 창의 연결 키와 접속 주소를 확인하세요.'})
                return
            try:
                length = int(self.headers.get('Content-Length', '0'))
                if not 0 < length <= 2_000_000:
                    raise ValueError('입력 데이터는 2MB 이하여야 합니다.')
                if not busy.acquire(blocking=False):
                    self.send_json(409, {'error': '이전 계산이 진행 중입니다.'})
                    return
                try:
                    payload = json.loads(self.rfile.read(length))
                    if not isinstance(payload, dict):
                        raise ValueError('JSON 객체를 입력하세요.')
                    result = solve_routes(payload)
                finally:
                    busy.release()
                self.send_json(200, result)
            except (ValueError, TypeError, OverflowError) as error:
                self.send_json(422, {'error': str(error)})
            except Exception:
                self.send_json(500, {'error': '계산 중 오류가 발생했습니다. 입력 형식을 확인하세요.'})

        def log_message(self, format, *arguments):
            return

    server = ThreadingHTTPServer(('127.0.0.1', args.port), Handler)
    print(f'OR-Tools local server: http://127.0.0.1:{args.port}', flush=True)
    print(f'Connection key: {token}', flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == '__main__':
    main()
