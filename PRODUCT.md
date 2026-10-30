# Product
<!-- impeccable:product-schema 1 -->
## Platform
web
## Users
센터의 배차 및 운영 업무를 처리하는 직원과 관리자. 사용자 확인: PC 중심이며 모바일에서도 조회·처리한다.
## Product Purpose
코스·기사·차량·납품처와 업무 등록·인계·처리 이력·첨부 서류를 기존 권한 안에서 관리한다.
## Capabilities and Constraints
운영 앱은 app/의 React·TypeScript·Vite이며 Supabase와 원본 DB·업무 처리 규칙을 유지한다. repo-root/는 기존 구현 참고 자료다. 새 페이지는 공통 WorkspaceProvider·WorkspaceFrame과 AdminPage를 재사용한다. 별도 오픈소스 메뉴나 중복 업무 화면을 만들지 않는다. AGENTS.md와 DESIGN.md를 기준으로 한다.
