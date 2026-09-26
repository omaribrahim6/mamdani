import { createContext, useContext, useState, type ReactNode } from 'react';

// Official-languages toggle for the console chrome (report content stays as residents wrote it).
export type Lang = 'en' | 'fr';

const STR = {
  phase: { en: 'Prototype', fr: 'Prototype' },
  phaseNote: { en: 'Unofficial. Not a City of Ottawa or Government of Canada service.', fr: 'Non officiel. Ce n’est pas un service de la Ville d’Ottawa ni du gouvernement du Canada.' },
  product: { en: 'City Operations Centre', fr: 'Centre des opérations municipales' },
  crumbOps: { en: 'Operations', fr: 'Opérations' },
  title: { en: 'Service requests', fr: 'Demandes de service' },
  signOut: { en: 'Sign out', fr: 'Se déconnecter' },
  open: { en: 'Open', fr: 'Ouvertes' },
  urgent: { en: 'Urgent', fr: 'Urgentes' },
  fixedToday: { en: 'Fixed today', fr: 'Réglées aujourd’hui' },
  medianFix: { en: 'Median time to fix', fr: 'Délai médian' },
  barriers: { en: 'Accessibility barriers', fr: 'Obstacles à l’accessibilité' },
  resolved: { en: 'Resolved', fr: 'Réglées' },
  all: { en: 'All', fr: 'Toutes' },
  queueCaption: { en: 'Service requests, highest priority first', fr: 'Demandes de service, priorité la plus élevée d’abord' },
  colId: { en: 'ID', fr: 'No' },
  colIssue: { en: 'Issue and location', fr: 'Problème et lieu' },
  colResidents: { en: 'Residents', fr: 'Résidents' },
  colPriority: { en: 'Priority', fr: 'Priorité' },
  colStatus: { en: 'Status', fr: 'État' },
  live: { en: 'Live · city record', fr: 'En direct · registre municipal' },
  offline: { en: 'Offline snapshot', fr: 'Instantané hors ligne' },
  briefing: { en: 'Mayor’s briefing', fr: 'Breffage du maire' },
  twin: { en: 'Downtown Ottawa · digital twin', fr: 'Centre-ville d’Ottawa · jumeau numérique' },
  rewound: { en: 'Rewound to', fr: 'Retour à' },
  now: { en: 'now', fr: 'maintenant' },
  hoursAgo: { en: '48 h ago', fr: 'il y a 48 h' },
  dragHint: { en: 'Drag to orbit · scroll to zoom · click a beam', fr: 'Glisser pour pivoter · défiler pour zoomer · cliquer un faisceau' },
  dateModified: { en: 'Date modified', fr: 'Date de modification' },
  footerNote: { en: 'Map data © OpenStreetMap contributors (ODbL) · Built at Hack the Hill III · Unofficial prototype', fr: 'Données cartographiques © contributeurs d’OpenStreetMap (ODbL) · Conçu à Hack the Hill III · Prototype non officiel' },
  empty: { en: 'Nothing here. The city is quiet.', fr: 'Rien ici. La ville est calme.' },
  on: { en: 'on this block', fr: 'dans ce secteur' },
} as const;

export type Key = keyof typeof STR;

const Ctx = createContext<{ lang: Lang; set: (l: Lang) => void; t: (k: Key) => string }>({ lang: 'en', set: () => {}, t: (k) => STR[k].en });

export function LangProvider({ children }: { children: ReactNode }) {
  const [lang, setLang] = useState<Lang>(() => {
    try { return (localStorage.getItem('lang') as Lang) || 'en'; } catch { return 'en'; }
  });
  const set = (l: Lang) => {
    setLang(l);
    document.documentElement.lang = l;
    try { localStorage.setItem('lang', l); } catch { /* private mode */ }
  };
  return <Ctx.Provider value={{ lang, set, t: (k) => STR[k][lang] }}>{children}</Ctx.Provider>;
}

export const useLang = () => useContext(Ctx);
