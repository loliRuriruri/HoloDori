import React, { useState } from 'react';
import { useI18n } from '../i18n';

interface FirstRunGuideProps {
  isOpen: boolean;
  onClose: (dontShowAgain?: boolean) => void;
}

export const FirstRunGuide: React.FC<FirstRunGuideProps> = ({ isOpen, onClose }) => {
  const { t } = useI18n();
  const [step, setStep] = useState<number>(1);
  const totalSteps = 6;

  if (!isOpen) return null;

  const handleNext = () => {
    if (step < totalSteps) {
      setStep(step + 1);
    } else {
      onClose(true);
    }
  };

  const handlePrev = () => {
    if (step > 1) {
      setStep(step - 1);
    }
  };

  const getStepContent = (s: number) => {
    switch (s) {
      case 1:
        return {
          icon: '✨',
          title: t('onboarding.step1_title'),
          desc: t('onboarding.step1_desc'),
          tip: 'Steam에 hololive Dreams가 설치되어 있으면 별도 설정 없이 바로 시작할 수 있습니다.',
        };
      case 2:
        return {
          icon: '🎮',
          title: t('onboarding.step2_title'),
          desc: t('onboarding.step2_desc'),
          tip: 'Steam 라이브러리가 다른 드라이브나 한글 경로에 있어도 자동으로 안전하게 탐색합니다.',
        };
      case 3:
        return {
          icon: '📦',
          title: t('onboarding.step3_title'),
          desc: t('onboarding.step3_desc'),
          tip: '아이돌의 기본 의상(001=nrml), 사복/유니크(002/004=uniq), 공용 의상(003=cmmn)을 자유롭게 선택할 수 있습니다.',
        };
      case 4:
        return {
          icon: '🎭',
          title: t('onboarding.step4_title'),
          desc: t('onboarding.step4_desc'),
          tip: '스페이스바(모션 재생/정지), R(랜덤 모션), F(화면 맞춤) 단축키를 활용해 보세요.',
        };
      case 5:
        return {
          icon: '🖥️',
          title: t('onboarding.step5_title'),
          desc: t('onboarding.step5_desc'),
          tip: '마우스 클릭 통과 기능을 켜면 캐릭터를 띄워둔 채로 뒤의 프로그램이나 게임을 자유롭게 조작할 수 있습니다.',
        };
      case 6:
        return {
          icon: '🖼️',
          title: t('onboarding.step6_title'),
          desc: t('onboarding.step6_desc'),
          tip: 'Windows Explorer가 재부팅되어도 감시자가 자동으로 2.5초 내에 배경화면 연결을 복구합니다.',
        };
      default:
        return { icon: '✨', title: '', desc: '', tip: '' };
    }
  };

  const content = getStepContent(step);

  return (
    <div className="hdm-modal-backdrop" onClick={() => onClose(false)}>
      <div className="hdm-guide-card" onClick={(e) => e.stopPropagation()}>
        <div className="hdm-guide-header">
          <div className="hdm-guide-badge">
            {step} / {totalSteps}
          </div>
          <button className="hdm-guide-close" onClick={() => onClose(false)} title={t('btn.close')}>
            ✕
          </button>
        </div>

        <div className="hdm-guide-body">
          <div className="hdm-guide-big-icon">{content.icon}</div>
          <h2 className="hdm-guide-title">{content.title}</h2>
          <p className="hdm-guide-desc">{content.desc}</p>
          {content.tip && (
            <div className="hdm-guide-tip">
              <span className="hdm-guide-tip-icon">💡</span>
              <span>{content.tip}</span>
            </div>
          )}
        </div>

        <div className="hdm-guide-dots">
          {Array.from({ length: totalSteps }).map((_, i) => (
            <div
              key={i}
              className={`hdm-guide-dot ${step === i + 1 ? 'active' : ''}`}
              onClick={() => setStep(i + 1)}
            />
          ))}
        </div>

        <div className="hdm-guide-footer">
          <div className="hdm-guide-footer-left">
            <button className="btn-text" onClick={() => onClose(true)}>
              {t('onboarding.dont_show_again')}
            </button>
          </div>
          <div className="hdm-guide-footer-right">
            {step > 1 && (
              <button className="btn-secondary" onClick={handlePrev}>
                {t('onboarding.prev')}
              </button>
            )}
            <button className="btn-primary" onClick={handleNext}>
              {step === totalSteps ? t('onboarding.finish') : t('onboarding.next')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
