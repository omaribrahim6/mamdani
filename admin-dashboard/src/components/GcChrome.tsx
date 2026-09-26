import type { ReactNode } from 'react';
import { useLang } from '../i18n';

// Government-of-Canada-style page chrome, without any official marks: phase banner, blue
// header with the product wordmark and the EN/FR toggle, the CGI accent strip, and the
// "Date modified" footer line.
export function Wordmark() {
  const { t } = useLang();
  return (
    <span className="wordmark">
      <strong>Mamdani</strong>
      <span>{t('product')}</span>
    </span>
  );
}

export function GcHeader({ children }: { children?: ReactNode }) {
  const { lang, set, t } = useLang();
  return (
    <>
      <a className="skip-link" href="#main">Skip to main content</a>
      <div className="phase-banner" role="note"><span className="phase-tag">{t('phase')}</span>{t('phaseNote')}</div>
      <header className="gc-header">
        <Wordmark />
        <div className="gc-header-right">
          {children}
          <button type="button" className="lang-toggle" lang={lang === 'en' ? 'fr' : 'en'} onClick={() => set(lang === 'en' ? 'fr' : 'en')}>
            {lang === 'en' ? 'Français' : 'English'}
          </button>
        </div>
      </header>
      <div className="accent-strip" aria-hidden="true" />
    </>
  );
}

export function GcFooter() {
  const { t } = useLang();
  const d = new Date().toISOString().slice(0, 10);
  return (
    <footer className="gc-footer">
      <p><span>{t('dateModified')}:</span> <time dateTime={d}>{d}</time></p>
      <p>{t('footerNote')}</p>
    </footer>
  );
}
