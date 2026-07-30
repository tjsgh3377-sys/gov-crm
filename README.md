# 고객관리 센터

정부지원사업 고객 · 일반고객 · 매출 통계 · 공고 알림 · 홈페이지 유지보수를 한 화면에서 관리하는 대시보드입니다.
순수 HTML/JS로 만들어져 있어 **두 가지 방식**으로 쓸 수 있습니다.

## 1) 링크로 바로 쓰기 (GitHub Pages)

> https://tjsgh3377-sys.github.io/gov-crm/

접속하면 `data.json`을 여는 화면이 나옵니다.

1. **📂 data.json 열기** → 내 PC의 `data.json` 선택
2. 편집
3. **저장하기** → 방금 선택한 그 파일에 그대로 저장 (Chrome·Edge)

처음 써 본다면 **＋ 빈 데이터로 시작** 또는 이 리포의 `data.sample.json`으로 열어 보세요.

- 데이터는 **서버로 전송되지 않습니다.** 브라우저 안에서만 열고, 저장도 내 PC의 파일에 직접 씁니다.
- Chrome·Edge가 아니면 제자리 저장이 안 되고 `data.json`이 **내려받아집니다.** 원본 파일을 교체해 주세요.
- 첨부 이미지·파일은 `data.json` 안에 base64로 들어갑니다(이미지 3MB, 파일 5MB 제한).
- 여러 사람이 동시에 같은 데이터를 편집할 수는 없습니다. 그 경우 2)를 쓰세요.

## 2) 내 PC에서 서버로 쓰기 (Windows)

`serve.ps1`(PowerShell 내장 웹서버)을 띄우면 로그인·자동저장·파일 업로드가 모두 동작합니다.

1. `admin.config.example.json`을 `admin.config.json`으로 복사하고 비밀번호를 정합니다.
2. `실행.bat` 더블클릭 → 브라우저에서 `http://localhost:8741/`
3. 저장하면 폴더의 `data.json`에 바로 기록되고 `data.backup.json`이 함께 남습니다.

## 이 리포에 없는 파일

고객 개인정보와 비밀번호는 커밋하지 않습니다(`.gitignore` 참고).

| 파일 | 설명 |
| --- | --- |
| `data.json` | 실제 고객 데이터. 각자 PC에만 보관 |
| `admin.config.json` | 로그인 비밀번호 |
| `uploads/` | 서버 모드에서 업로드된 첨부파일 |

## 구성

| 파일 | 설명 |
| --- | --- |
| `index.html` | 화면·스타일 |
| `app.js` | 전체 로직 (서버가 없으면 자동으로 파일 모드로 동작) |
| `serve.ps1` | PowerShell 웹서버 + 저장/업로드 API |
| `data.sample.json` | 구조 확인용 샘플 데이터 |
