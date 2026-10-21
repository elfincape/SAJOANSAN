import * as XLSX from 'xlsx';
import { excelAddresses } from './distance';
export interface RelationSource {
  address: string;
  name?: string;
  source?: string;
  sourceRow: number;
  sourceSheet?: string;
  customer?: unknown;
  quantity?: unknown;
  originalCourse?: unknown;
  otd?: string;
  issue?: string;
}
export async function relationFiles(files: File[]): Promise<RelationSource[]> {
  const rows: RelationSource[] = [];
  for (const file of files) {
    if (file.size > 30 * 1024 * 1024)
      throw Error('각 파일은 30MB 이하로 선택해 주세요.');
    const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' }),
      name =
        wb.SheetNames.find((n) => n === 'Sheet1') ??
        wb.SheetNames.find((n) => wb.Sheets[n]['!ref']);
    if (!name) throw Error(file.name + '에 주소 자료가 없습니다.');
    const sheet = wb.Sheets[name];
    const data = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
        header: 1,
        defval: '',
        range: 0,
      }),
      headerRow = data
        .slice(0, 30)
        .findIndex((r) =>
          r.some((v) =>
            /^주소$|배송주소|납품처주소/.test(String(v).replace(/\s/g, '')),
          ),
        );
    if (headerRow < 0)
      throw Error(file.name + '의 주소 열을 확인하지 못했습니다.');
    const header = data[headerRow].map((v) => String(v).replace(/\s/g, '')),
      addressColumn = header.findIndex((v) =>
        /^주소$|배송주소|납품처주소/.test(v),
      );
    let nameColumn = header.findIndex((v) =>
      /^(착지|착지명|납품처|납품처명|거래처|거래처명|업체명)$/.test(v),
    );
    if (nameColumn < 0) nameColumn = Math.max(0, addressColumn - 1);
    const timeColumn = header.findIndex((v) =>
      /OTD|납품시간|도착시간|^시간$/i.test(v),
    );
    const customerColumn = header.findIndex((v) =>
        /^(고객사|고객사명)$/.test(v),
      ),
      quantityColumn = header.findIndex((v) => /물량|박스|수량/.test(v)),
      courseColumn = header.findIndex((v) =>
        /^(코스|코스명|차량번호|호차)$/.test(v),
      );
    const cell = (row: number, column: number) => {
      if (column < 0) return '';
      const merged = (sheet['!merges'] ?? []).find(
          (m) =>
            row >= m.s.r && row <= m.e.r && column >= m.s.c && column <= m.e.c,
        ),
        value =
          sheet[
            XLSX.utils.encode_cell(merged ? merged.s : { r: row, c: column })
          ];
      return value?.t === 'e' ? '' : (value?.v ?? '');
    };
    rows.push(
      ...excelAddresses(sheet, XLSX, {
        addressColumn,
        nameColumn,
        startRow: headerRow + 2,
      }).map((r) => ({
        ...r,
        source: file.name,
        sourceSheet: name,
        customer: cell(r.sourceRow - 1, customerColumn),
        quantity: cell(r.sourceRow - 1, quantityColumn),
        originalCourse: cell(r.sourceRow - 1, courseColumn),
        otd: String(cell(r.sourceRow - 1, timeColumn)),
      })),
    );
    if (rows.length > 20000) throw Error('합계 20,000행 이하로 선택해 주세요.');
  }
  return rows;
}
