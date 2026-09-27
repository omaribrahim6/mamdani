// Printing: each print says what it's for, and the print styles (styles/print.css) show only that
// — a work order prints the open work order; the brief prints the brief. Always on light paper.
export function printAs(mode: 'issue' | 'brief') {
  const root = document.documentElement;
  const theme = root.dataset.theme;
  root.dataset.print = mode;
  root.dataset.theme = 'light';
  const done = () => {
    delete root.dataset.print;
    if (theme) root.dataset.theme = theme;
    else delete root.dataset.theme;
    removeEventListener('afterprint', done);
  };
  addEventListener('afterprint', done);
  window.print();
}
