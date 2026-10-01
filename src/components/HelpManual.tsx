import React, { useState, useMemo } from 'react';
import { useI18n } from '../i18n';
import { openPath } from '@tauri-apps/plugin-opener';

interface HelpManualProps {
  isOpen: boolean;
  onClose: () => void;
  initialTopic?: string;
  onRestartOnboarding?: () => void;
  outputDir?: string;
}

export type HelpTopicId =
  | 'intro'
  | 'quickstart'
  | 'library'
  | 'importer'
  | 'viewer'
  | 'animations'
  | 'desktop'
  | 'wallpaper'
  | 'shortcuts'
  | 'glossary'
  | 'troubleshooting'
  | 'about';

interface TopicDef {
  id: HelpTopicId;
  titleKey: string;
  icon: string;
  keywords: string[];
}

const TOPICS: TopicDef[] = [
  { id: 'intro', titleKey: 'help.tab_intro', icon: '📖', keywords: ['hdm', '소개', '개요', 'live2d', 'about'] },
  { id: 'quickstart', titleKey: 'help.tab_quickstart', icon: '🚀', keywords: ['처음', '시작', '빠른 시작', '방법', 'start', 'guide'] },
  { id: 'library', titleKey: 'help.tab_library', icon: '📚', keywords: ['라이브러리', '캐릭터', '의상', '선택', 'library'] },
  { id: 'importer', titleKey: 'help.tab_importer', icon: '📥', keywords: ['가져오기', 'steam', '추출', '생성', 'import'] },
  { id: 'viewer', titleKey: 'help.tab_viewer', icon: '👁️', keywords: ['뷰어', '카메라', '줌', '화면 맞춤', 'viewer', 'controls'] },
  { id: 'animations', titleKey: 'help.tab_animations', icon: '🎭', keywords: ['모션', '표정', '자동 모션', '물리', 'motion', 'expression'] },
  { id: 'desktop', titleKey: 'help.tab_desktop', icon: '🖥️', keywords: ['데스크톱', '마스코트', '편집', '잠금', '클릭 통과', 'desktop'] },
  { id: 'wallpaper', titleKey: 'help.tab_wallpaper', icon: '🖼️', keywords: ['배경화면', 'workerw', 'progman', '오버레이', '아이콘 뒤', 'wallpaper'] },
  { id: 'shortcuts', titleKey: 'help.tab_shortcuts', icon: '⌨️', keywords: ['단축키', '키보드', '조작', 'shortcuts', 'keys'] },
  { id: 'glossary', titleKey: 'help.tab_glossary', icon: '💡', keywords: ['용어', '사전', 'moc3', 'cubism', 'glossary'] },
  { id: 'troubleshooting', titleKey: 'help.tab_troubleshooting', icon: '🔧', keywords: ['문제 해결', '오류', '버그', '안됨', 'troubleshooting'] },
  { id: 'about', titleKey: 'help.tab_about', icon: 'ℹ️', keywords: ['정보', '버전', '라이선스', '제작', 'about'] },
];

export const HelpManual: React.FC<HelpManualProps> = ({
  isOpen,
  onClose,
  initialTopic = 'intro',
  onRestartOnboarding,
  outputDir,
}) => {
  const { t } = useI18n();
  const [activeTopic, setActiveTopic] = useState<HelpTopicId>(initialTopic as HelpTopicId);
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Synchronize initialTopic if modal re-opened
  React.useEffect(() => {
    if (initialTopic && TOPICS.some((tp) => tp.id === initialTopic)) {
      setActiveTopic(initialTopic as HelpTopicId);
    }
  }, [initialTopic, isOpen]);

  const filteredTopics = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return TOPICS;
    return TOPICS.filter((tp) => {
      const title = t(tp.titleKey).toLowerCase();
      const kw = tp.keywords.join(' ').toLowerCase();
      return title.includes(q) || kw.includes(q);
    });
  }, [searchQuery, t]);

  if (!isOpen) return null;

  const handleOpenGitHubDocs = async () => {
    try {
      await openPath('https://github.com/loliRuriruri/HoloDori/blob/main/docs/INDEX.md');
    } catch {
      window.open('https://github.com/loliRuriruri/HoloDori/blob/main/docs/INDEX.md', '_blank');
    }
  };

  const handleOpenOutputDir = async () => {
    if (outputDir) {
      try {
        await openPath(outputDir);
      } catch (e) {
        console.warn('Could not open output folder', e);
      }
    }
  };

  const renderContent = () => {
    switch (activeTopic) {
      case 'intro':
        return (
          <div className="hdm-manual-article">
            <h2>{t('help.tab_intro')}</h2>
            <p>
              <strong>HoloDori Live2D Manager (HDM)</strong>는 <em>hololive Dreams</em>에 등장하는
              3D/Live2D 캐릭터 모델을 추출하여 고화질 WebGL 뷰어에서 감상하고, 투명한 데스크톱 마스코트 및
              Windows 라이브 배경화면으로 활용할 수 있도록 제작된 비공식 유틸리티입니다.
            </p>
            <h3>주요 기능</h3>
            <ul>
              <li><strong>스마트 게임 감지</strong>: Steam 설치 경로 및 라이브러리 폴더를 자동으로 감지하여 에셋을 읽어옵니다.</li>
              <li><strong>정통 Live2D 추출</strong>: 암호화된 카탈로그에서 MOC3 모델, 고해상도 텍스처, 실시간 물리 효과를 온전히 추출합니다.</li>
              <li><strong>풍부한 애니메이션</strong>: 실제 인게임 모션과 표정을 부드러운 전환과 함께 감상할 수 있습니다.</li>
              <li><strong>투명 데스크톱 마스코트</strong>: 항상 화면 위에 떠 있거나 클릭 통과(Click-through)로 다른 작업을 방해하지 않는 캐릭터 창을 지원합니다.</li>
              <li><strong>진정한 Windows 라이브 배경화면</strong>: 바탕화면 아이콘 뒤로 완벽하게 배치되는 WorkerW / Progman 임베딩을 제공합니다.</li>
            </ul>
          </div>
        );

      case 'quickstart':
        return (
          <div className="hdm-manual-article">
            <h2>{t('help.tab_quickstart')}</h2>
            <p>처음 사용하는 분들도 아래의 6단계를 따르면 1분 안에 캐릭터를 실행할 수 있습니다.</p>
            <ol className="hdm-manual-steps">
              <li>
                <strong>HoloDori 게임 설치 확인</strong>: Steam에 <em>hololive Dreams</em>가 정상적으로 설치되어 있는지 확인합니다.
              </li>
              <li>
                <strong>캐릭터 가져오기 화면 열기</strong>: 상단 메뉴에서 <code>[캐릭터 가져오기]</code>를 클릭합니다.
              </li>
              <li>
                <strong>Steam 자동 검색</strong>: <code>[Steam 게임 자동 검색]</code> 버튼을 누르면 설치 경로와 캐릭터 목록이 즉시 표시됩니다.
              </li>
              <li>
                <strong>캐릭터 및 의상 선택</strong>: 원하는 아이돌과 의상(기본 사복, 라이브 의상 등)을 체크하고 <code>[선택한 모델 가져오기 및 생성]</code>을 누릅니다.
              </li>
              <li>
                <strong>뷰어에서 감상</strong>: 생성이 완료되면 <code>[뷰어 실행]</code>을 눌러 모션, 표정, 물리 효과를 확인합니다.
              </li>
              <li>
                <strong>데스크톱 또는 배경화면으로 내보내기</strong>: 뷰어 상단의 <code>[데스크톱으로 보내기]</code> 또는 <code>[라이브 배경화면으로 설정]</code>을 클릭합니다!
              </li>
            </ol>
            {onRestartOnboarding && (
              <div style={{ marginTop: '20px' }}>
                <button className="btn-secondary" onClick={onRestartOnboarding}>
                  🎉 {t('onboarding.restart_guide')}
                </button>
              </div>
            )}
          </div>
        );

      case 'library':
        return (
          <div className="hdm-manual-article">
            <h2>{t('help.tab_library')}</h2>
            <p>
              가져온 모든 캐릭터 모델은 라이브러리에 저장되며 언제든 빠르게 검색하고 실행할 수 있습니다.
            </p>
            <h3>화면 조작 안내</h3>
            <ul>
              <li><strong>검색창</strong>: 캐릭터 ID (예: <code>00007</code>), 이름, 의상 토큰 (예: <code>001</code>)으로 실시간 필터링됩니다.</li>
              <li><strong>의상 카드 선택</strong>: 각 캐릭터 카드 아래의 의상 뱃지를 누르면 해당 의상으로 즉시 전환됩니다.</li>
              <li><strong>뷰어 실행</strong>: 카드의 <code>[뷰어 실행]</code> 버튼을 클릭하면 대형 WebGL 뷰어가 열립니다.</li>
              <li><strong>일괄 생성 (Batch Build)</strong>: 로컬 파일 모드일 때 준비된 모든 모델을 한 번에 패키지로 변환할 수 있습니다.</li>
            </ul>
          </div>
        );

      case 'importer':
        return (
          <div className="hdm-manual-article">
            <h2>{t('help.tab_importer')}</h2>
            <p>
              게임 데이터 파일에서 안전하게 MOC3 모델과 텍스처를 디코딩하는 핵심 변환기입니다.
            </p>
            <h3>중복 처리 방식 (Conflict Policy)</h3>
            <ul>
              <li><strong>기존 파일 건너뛰기 (Skip)</strong>: 이미 변환된 모델이 폴더에 있으면 다시 작업하지 않고 건너뜁니다. (추천)</li>
              <li><strong>고유 번호 붙이기 (Unique Suffix)</strong>: 기존 파일을 보존하고 <code>_001</code> 형태의 번호를 붙여 새로 만듭니다.</li>
              <li><strong>덮어쓰기 (Overwrite)</strong>: 기존 파일을 새로운 데이터로 완전히 대체합니다.</li>
            </ul>
            <h3>캐시 관리</h3>
            <p>
              다운로드하거나 추출한 에셋 번들은 로컬 캐시에 저장되어 다음번에 즉시 불러옵니다.
              디스크 용량이 부족할 때만 <code>[캐시 비우기]</code>를 사용하세요.
            </p>
          </div>
        );

      case 'viewer':
        return (
          <div className="hdm-manual-article">
            <h2>{t('help.tab_viewer')}</h2>
            <p>공식 Live2D Cubism WebGL 런타임을 통해 캐릭터를 부드럽게 렌더링합니다.</p>
            <h3>마우스 조작법</h3>
            <ul>
              <li><strong>이동 (Pan)</strong>: 캔버스를 좌클릭한 채로 드래그하면 카메라가 이동합니다.</li>
              <li><strong>확대 / 축소 (Zoom)</strong>: 마우스 휠을 굴려 0.2배에서 8.0배까지 부드럽게 줌 인/아웃합니다.</li>
              <li><strong>화면 맞춤 (Fit)</strong>: 캔버스를 더블 클릭하거나 단축키 <code>F</code>를 누르면 캐릭터가 화면 중앙에 맞춤 정렬됩니다.</li>
              <li><strong>카메라 초기화</strong>: 단축키 <code>0</code>을 누르면 100% 배율 기본 위치로 복귀합니다.</li>
            </ul>
          </div>
        );

      case 'animations':
        return (
          <div className="hdm-manual-article">
            <h2>{t('help.tab_animations')}</h2>
            <h3>모션 (Motions)</h3>
            <p>
              캐릭터별 게임 고유 모션(인사, 대기, 댄스, 제스처 등)을 재생할 수 있습니다.
              <code>[자동 모션]</code> 스위치를 켜면 설정한 시간(초)마다 자동으로 새로운 모션을 취합니다.
            </p>
            <h3>표정 (Expressions)</h3>
            <p>
              미소, 홍조, 놀람, 윙크 등 얼굴 표정을 덮어씌웁니다. <code>[표정 초기화]</code>를 누르면 중립 표정으로 돌아옵니다.
            </p>
            <h3>물리 효과 (Physics)</h3>
            <p>
              머리카락, 리본, 치마 자락이 중력과 관성에 맞춰 자연스럽게 흔들립니다. 툴바에서 물리 효과를 켜거나 끌 수 있습니다.
            </p>
          </div>
        );

      case 'desktop':
        return (
          <div className="hdm-manual-article">
            <h2>{t('help.tab_desktop')}</h2>
            <p>
              메인 창에서 <code>[데스크톱으로 보내기]</code>를 클릭하면 배경이 투명한 별도의 마스코트 창이 생성됩니다.
            </p>
            <h3>편집 모드 vs 잠금 모드</h3>
            <ul>
              <li><strong>편집 모드 (Edit)</strong>: 캐릭터를 자유롭게 드래그해 원하는 곳에 배치하고 모서리로 크기를 조절합니다.</li>
              <li><strong>잠금 모드 (Lock)</strong>: 위치가 고정되어 실수로 마우스로 건드려도 이동하지 않습니다.</li>
            </ul>
            <h3>클릭 통과 (Click-Through)</h3>
            <p>
              마우스 클릭이 캐릭터를 그대로 뚫고 지나가 뒤에 있는 웹 브라우저나 문서를 작업할 수 있습니다.
              클릭 통과 중에는 캐릭터 우클릭이 불가능하므로, <strong><code>Ctrl + Shift + D</code></strong> 단축키나
              작업 표시줄 우측의 <strong>시스템 트레이 아이콘</strong>을 우클릭하여 편집 모드로 복구할 수 있습니다.
            </p>
          </div>
        );

      case 'wallpaper':
        return (
          <div className="hdm-manual-article">
            <h2>{t('help.tab_wallpaper')}</h2>
            <p>
              Windows 탐색기(Explorer) 셸과 완벽하게 통합되어 바탕화면 아이콘 뒤로 캐릭터를 띄웁니다.
            </p>
            <h3>호스트 방식 안내</h3>
            <ul>
              <li><strong>WorkerW (기본)</strong>: Windows 10/11의 바탕화면 전용 내부 레이어입니다. 아이콘 선택, 드래그 영역 상자가 캐릭터 위로 자연스럽게 올라옵니다.</li>
              <li><strong>Progman 호환 모드</strong>: 일부 Windows 환경에서 WorkerW 대신 사용하는 대체 셸 창입니다.</li>
              <li><strong>화면 위 표시 (오버레이 호환)</strong>: 셸 임베딩이 지원되지 않는 특수 환경에서 안전하게 투명 창으로 자동 전환되어 캐릭터가 가려지지 않게 보호합니다.</li>
            </ul>
            <h3>탐색기 자동 복구 감시자 (Watchdog)</h3>
            <p>
              작업 관리자에서 Explorer를 다시 시작하거나 윈도우 그래픽 드라이버가 재설정되어도,
              백그라운드 감시자가 2.5초 안에 핸들을 자동 재감지하여 배경화면을 복원합니다.
            </p>
          </div>
        );

      case 'shortcuts':
        return (
          <div className="hdm-manual-article">
            <h2>{t('help.tab_shortcuts')}</h2>
            <table className="hdm-manual-table">
              <thead>
                <tr>
                  <th>단축키</th>
                  <th>동작 설명</th>
                  <th>사용 가능한 화면</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td><code>Space</code></td>
                  <td>현재 모션 재생 / 일시정지 토글</td>
                  <td>Live2D 뷰어</td>
                </tr>
                <tr>
                  <td><code>R</code></td>
                  <td>사용 가능한 모션 중 무작위(랜덤) 모션 즉시 재생</td>
                  <td>Live2D 뷰어 / 데스크톱</td>
                </tr>
                <tr>
                  <td><code>F</code></td>
                  <td>화면 맞춤 (Fit to Canvas)</td>
                  <td>Live2D 뷰어</td>
                </tr>
                <tr>
                  <td><code>더블 클릭</code></td>
                  <td>화면 중앙 맞춤</td>
                  <td>Live2D 뷰어</td>
                </tr>
                <tr>
                  <td><code>0</code> (숫자영)</td>
                  <td>카메라 배율 및 위치 100% 원점 초기화</td>
                  <td>Live2D 뷰어</td>
                </tr>
                <tr>
                  <td><code>F11</code></td>
                  <td>전체 화면 모드 전환</td>
                  <td>Live2D 뷰어</td>
                </tr>
                <tr>
                  <td><code>Esc</code></td>
                  <td>전체 화면 종료 / 팝업 닫기</td>
                  <td>모든 화면</td>
                </tr>
                <tr>
                  <td><code>Ctrl + Shift + D</code></td>
                  <td><strong>데스크톱 캐릭터 편집 모드로 즉시 복구</strong> (클릭 통과 해제)</td>
                  <td>Windows 전역</td>
                </tr>
              </tbody>
            </table>
          </div>
        );

      case 'glossary':
        return (
          <div className="hdm-manual-article">
            <h2>{t('help.tab_glossary')}</h2>
            <dl className="hdm-manual-glossary">
              <dt>Live2D</dt>
              <dd>2D 일러스트의 원화 매력을 온전히 유지하면서 입체적으로 움직이게 하는 일본 Live2D사의 독자 그래픽 기술입니다.</dd>

              <dt>MOC3</dt>
              <dd>Live2D Cubism 3/4/5 세대의 컴파일된 핵심 바이너리 모델 파일 포맷입니다.</dd>

              <dt>모션 (Motion / motion3.json)</dt>
              <dd>시간의 흐름에 따라 각 파라미터 곡선(Bézier Curves)이 변화하며 춤추거나 인사하는 애니메이션 데이터입니다.</dd>

              <dt>표정 (Expression / exp3.json)</dt>
              <dd>눈 모양, 입 형태, 볼 홍조 파라미터를 고정하거나 덮어씌워 감정을 나타내는 얼굴 표정 데이터입니다.</dd>

              <dt>물리 효과 (Physics / physics3.json)</dt>
              <dd>진자(Pendulum) 알고리즘을 사용해 머리카락이나 장식품이 캐릭터의 움직임과 중력에 따라 흔들리게 계산하는 물리 연산 데이터입니다.</dd>

              <dt>WorkerW</dt>
              <dd>Windows 탐색기(Explorer)가 데스크톱 바탕화면을 표시하기 위해 생성하는 투명 내부 창입니다. HDM은 이 창 뒤로 Live2D 캔버스를 결합합니다.</dd>

              <dt>Progman</dt>
              <dd>Program Manager의 약자로 Windows의 최상위 바탕화면 셸 호스트 창입니다.</dd>

              <dt>WebGL</dt>
              <dd>웹 브라우저 및 내장 뷰어 환경에서 GPU 하드웨어 가속을 활용해 고성능 2D/3D 그래픽을 렌더링하는 표준 기술입니다.</dd>
            </dl>
          </div>
        );

      case 'troubleshooting':
        return (
          <div className="hdm-manual-article">
            <h2>{t('help.tab_troubleshooting')}</h2>
            <h3>자주 발생하는 문제 및 해결 방법</h3>
            <div className="hdm-faq-item">
              <h4>Q. Steam 게임을 자동으로 찾지 못합니다.</h4>
              <p>
                A. Steam이 기본 C드라이브가 아닌 다른 보조 드라이브(D:, E: 등)에 설치되어 있거나 한글/특수문자 폴더에 있는 경우,
                <code>[수동으로 게임 폴더 선택]</code> 버튼을 눌러 <code>hololive Dreams</code> 폴더를 직접 지정해 주시면 정상 인식됩니다.
              </p>
            </div>
            <div className="hdm-faq-item">
              <h4>Q. 뷰어 화면이 검은색으로 나오고 모델이 보이지 않습니다.</h4>
              <p>
                A. Live2D 공식 코어 라이브러리(<code>live2dcubismcore.min.js</code>)가 로컬에 배치되어 있는지 확인하세요.
                또한 더블 클릭 또는 단축키 <code>F</code>를 눌러 카메라 위치를 화면 중앙에 맞춰 보세요.
              </p>
            </div>
            <div className="hdm-faq-item">
              <h4>Q. 데스크톱 캐릭터가 클릭되지 않고 다른 프로그램만 클릭됩니다.</h4>
              <p>
                A. '클릭 통과(Click-through)' 기능이 켜져 있는 상태입니다. 키보드의 <strong><code>Ctrl + Shift + D</code></strong>를 누르거나
                화면 우측 하단 트레이 아이콘을 우클릭하여 <code>[편집 모드로 전환]</code>을 선택하세요.
              </p>
            </div>
            <div className="hdm-faq-item">
              <h4>Q. 라이브 배경화면이 바탕화면 아이콘을 가립니다.</h4>
              <p>
                A. 일부 Windows 업데이트 환경에서 호스트 창이 오버레이 모드로 작동했을 수 있습니다.
                트레이 메뉴에서 <code>[배경화면 복구]</code>를 누르면 Explorer 내부 WorkerW 창으로 다시 연결됩니다.
              </p>
            </div>
          </div>
        );

      case 'about':
        return (
          <div className="hdm-manual-article">
            <h2>{t('about.title')}</h2>
            <div className="hdm-about-box">
              <div className="hdm-about-badge">v1.0.0 Stable</div>
              <p>{t('about.description')}</p>
              <p className="hdm-about-disclaimer">⚠️ {t('about.disclaimer')}</p>
              <div className="hdm-about-specs">
                <div><strong>운영체제:</strong> Windows 10 (1809+) / Windows 11 (22H2, 24H2, 25H2)</div>
                <div><strong>백엔드:</strong> Rust (tauri 2.2, win32 shell integration)</div>
                <div><strong>프론트엔드:</strong> React 18, TypeScript, WebGL 2.0</div>
                <div><strong>엔진:</strong> Live2D Cubism SDK for Web v5</div>
              </div>
              <div className="hdm-about-buttons">
                <button className="btn-secondary" onClick={handleOpenGitHubDocs}>
                  🌐 {t('about.btn_github')}
                </button>
                {outputDir && (
                  <button className="btn-secondary" onClick={handleOpenOutputDir}>
                    📁 {t('about.btn_open_output')}
                  </button>
                )}
              </div>
            </div>
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <div className="hdm-modal-backdrop" onClick={onClose}>
      <div className="hdm-manual-modal" onClick={(e) => e.stopPropagation()}>
        <div className="hdm-manual-header">
          <div className="hdm-manual-header-title">
            <span className="hdm-manual-icon">📖</span>
            <h3>{t('help.title')}</h3>
          </div>
          <button className="hdm-guide-close" onClick={onClose} title={t('btn.close')}>
            ✕
          </button>
        </div>

        <div className="hdm-manual-search-bar">
          <input
            type="text"
            className="hdm-manual-search-input"
            placeholder={t('help.search_placeholder')}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          {searchQuery && (
            <button className="hdm-search-clear" onClick={() => setSearchQuery('')}>
              ✕
            </button>
          )}
        </div>

        <div className="hdm-manual-container">
          <aside className="hdm-manual-sidebar">
            <nav className="hdm-manual-nav">
              {filteredTopics.map((tp) => (
                <button
                  key={tp.id}
                  className={`hdm-manual-nav-btn ${activeTopic === tp.id ? 'active' : ''}`}
                  onClick={() => setActiveTopic(tp.id)}
                >
                  <span className="nav-icon">{tp.icon}</span>
                  <span className="nav-label">{t(tp.titleKey)}</span>
                </button>
              ))}
            </nav>
            <div className="hdm-manual-sidebar-footer">
              <button className="btn-text-link" onClick={handleOpenGitHubDocs}>
                {t('help.open_github_docs')}
              </button>
            </div>
          </aside>

          <main className="hdm-manual-main">{renderContent()}</main>
        </div>
      </div>
    </div>
  );
};
