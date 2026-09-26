# New World

브라우저에서 플레이하는 3인칭 판타지 모험 스토리 게임입니다. Three.js로 만들었습니다.

## 제1장 · 꺼진 등불

아르델 계곡을 지켜 온 대등불이 꺼지고 잿빛 안개가 내려옵니다. 기사 레온이 되어 마을의 마법사 엘라라를 만나고,
숲의 돌무덤, 거울 호숫가, 서쪽 옛 성터에 흩어진 빛의 파편 세 조각을 모아 등불탑에 불을 되살립니다.
파편을 하나 찾을 때마다 안개가 걷히고, 등불이 켜지면 계곡이 황금빛으로 바뀝니다.

## 조작

| 키 | 동작 |
| --- | --- |
| W A S D / 방향키 | 이동 (기본 달리기) |
| Shift | 걷기 |
| Space | 점프, 대사 넘기기, 오프닝 건너뛰기 |
| E | 대화, 파편 줍기 |
| 마우스 (클릭 후) | 시점 회전, 휠로 거리 조절 |

터치 기기에서는 왼쪽 가상 스틱과 오른쪽 드래그, E / 점프 버튼을 씁니다.

## 실행

```bash
npm install
npm run dev          # 개발 서버
npm run build        # dist/ 에 정적 빌드
npm run build:artifact  # .glb 대신 임베드된 glTF JSON을 쓰는 호스팅용 빌드 (dist-artifact/)
```

`node scripts/shot.mjs village dialogue tower` 로 헤드리스 스크린샷을 찍을 수 있습니다 (`vite preview` 실행 중일 때).

## 구조

- `src/terrain.js` 800m 계곡 높이맵, 길, 호수, 산맥, 지면 색
- `src/world.js` 하늘, 호수 반사, 바람에 흔들리는 GPU 풀, 건물과 숲 배치, 충돌
- `src/characters.js` 캐릭터 로딩, 애니메이션, 플레이어 조작, NPC
- `src/controls.js` 키보드, 마우스, 터치 입력과 3인칭 카메라
- `src/story.js` 대사와 퀘스트 텍스트
- `src/main.js` 렌더러, 후처리, 퀘스트 진행, 컷신, UI

## 에셋

모두 CC0 (상업적 사용 가능) 입니다.

- 캐릭터: [KayKit Adventurers Character Pack](https://github.com/KayKit-Game-Assets/KayKit-Character-Pack-Adventures-1.0) by Kay Lousberg
- 건물, 소품, 나무, 바위: [KayKit Medieval Hexagon Pack](https://github.com/KayKit-Game-Assets/KayKit-Medieval-Hexagon-Pack-1.0) by Kay Lousberg
- 물 노멀맵: three.js 예제 텍스처 (MIT)

`npm run prep` 은 위 저장소를 `~/assets` 에 클론해 둔 상태에서 필요한 모델만 골라 애니메이션을 줄이고 `.glb` 로 변환합니다.
