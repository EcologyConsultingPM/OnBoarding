export const OFFICE_RISK_STYLE = `
  .ora {
    max-width: 1080px;
    margin: 0 auto;
    padding: clamp(14px, 2.5vw, 28px) clamp(10px, 2vw, 20px) 72px;
    color: #22382a;
    font: 14px/1.5 Inter, Archivo, Arial, Helvetica, sans-serif;
  }
  .ora * { box-sizing: border-box; }
  .ora-back {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    margin: 0 0 12px;
    padding: 6px 0;
    border: 0;
    background: transparent;
    color: #1e6039;
    font: 750 13px/1.2 Inter, Archivo, Arial, sans-serif;
    cursor: pointer;
  }
  .ora-back:hover { color: #103f26; text-decoration: underline; text-underline-offset: 3px; }
  .ora-hero {
    display: flex;
    justify-content: space-between;
    gap: 20px;
    align-items: flex-start;
    padding: clamp(22px, 4vw, 34px);
    border: 1px solid #245c3a;
    border-radius: 16px 16px 12px 12px;
    background: linear-gradient(122deg, #0b2f1e 0%, #12482d 50%, #216742 100%);
    box-shadow: 0 16px 34px -23px rgba(8, 45, 28, .6);
    color: #f9fbf5;
  }
  .ora-hero > svg { flex: 0 0 auto; margin: 3px 2px 0 0; color: #e7c979; }
  .ora-hero span, .ora-kicker {
    display: block;
    color: #f1d881;
    font: 800 10.5px/1.3 "IBM Plex Mono", ui-monospace, monospace;
    letter-spacing: .11em;
    text-transform: uppercase;
  }
  .ora h1 {
    margin: 9px 0 7px;
    color: #fffdf5;
    font: 400 clamp(28px, 4.1vw, 40px)/1.05 Newsreader, Georgia, serif;
    letter-spacing: -.02em;
  }
  .ora-hero p { max-width: 730px; margin: 0; color: #e4f0e4; font-size: 14px; line-height: 1.55; }
  .ora-notice, .ora-error, .ora-guide {
    display: flex;
    align-items: flex-start;
    gap: 9px;
    margin: 15px 0;
    padding: 12px 14px;
    border-radius: 9px;
    font-size: 13px;
    line-height: 1.48;
  }
  .ora-notice--info { border: 1px solid #accbb2; background: #ecf7ed; color: #1d5732; }
  .ora-notice--error, .ora-error { border: 1px solid #e0aba3; background: #fff1ef; color: #842d25; }
  .ora-section {
    margin: 15px 0;
    overflow: hidden;
    border: 1px solid #cfddd0;
    border-radius: 13px;
    background: #fffefa;
    box-shadow: 0 10px 28px -25px rgba(10, 52, 30, .5);
  }
  .ora-section > header {
    display: flex;
    align-items: flex-start;
    gap: 11px;
    padding: 15px 18px;
    border-bottom: 1px solid #dce7dc;
    background: linear-gradient(90deg, #edf6ee, #f8fbf6);
  }
  .ora-section > header > span {
    display: grid;
    place-items: center;
    flex: 0 0 28px;
    width: 28px;
    height: 28px;
    border-radius: 8px;
    background: #1e643d;
    box-shadow: inset 0 0 0 1px rgba(255,255,255,.24);
    color: #fff;
    font: 800 12px/1 Inter, Arial, sans-serif;
  }
  .ora-section h2 { margin: 1px 0 0; color: #1b442c; font: 750 17px/1.2 Inter, Archivo, Arial, sans-serif; }
  .ora-section header p { margin: 4px 0 0; color: #566c5b; font-size: 12.5px; line-height: 1.42; }
  .ora-progress {
    align-self: center;
    margin-left: auto;
    padding: 5px 9px;
    border: 1px solid #dfc16d;
    border-radius: 999px;
    background: #fff8df;
    color: #725a13;
    font-size: 11px;
    white-space: nowrap;
  }
  .ora-body { padding: 18px; }
  .ora-details-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14px; }
  .ora-details-grid label, .ora-note, .ora-signed-date {
    display: grid;
    gap: 6px;
    color: #365340;
    font-size: 11px;
    font-weight: 800;
    letter-spacing: .045em;
    text-transform: uppercase;
  }
  .ora label small { color: #617466; font-size: 11px; font-weight: 550; letter-spacing: 0; text-transform: none; }
  .ora input, .ora textarea {
    width: 100%;
    border: 1px solid #afc2b2;
    border-radius: 8px;
    background: #fff;
    color: #1b3122;
    font: 14px/1.45 Inter, Arial, Helvetica, sans-serif;
  }
  .ora input { min-height: 43px; padding: 9px 11px; }
  .ora textarea { min-height: 72px; padding: 10px 11px; resize: vertical; }
  .ora input:hover, .ora textarea:hover { border-color: #779f7e; }
  .ora input:focus-visible, .ora textarea:focus-visible, .ora button:focus-visible {
    outline: 3px solid rgba(225, 184, 70, .55);
    outline-offset: 2px;
    border-color: #287249;
  }
  .ora-guide {
    display: block;
    margin-top: 0;
    border: 1px solid #e3ce8c;
    border-left: 4px solid #bd912b;
    background: #fff9e8;
    color: #594918;
  }
  .ora-guide b { color: #4c3d0c; }
  .ora-category {
    margin-top: 11px;
    overflow: hidden;
    border: 1px solid #cfddd0;
    border-radius: 10px;
    background: #fff;
  }
  .ora-category-head {
    display: grid;
    grid-template-columns: 30px minmax(0, 1fr) auto 20px;
    gap: 10px;
    align-items: center;
    width: 100%;
    padding: 13px 14px;
    border: 0;
    border-left: 4px solid transparent;
    background: #f5faf5;
    color: #1a432b;
    text-align: left;
    font: inherit;
    cursor: pointer;
    transition: background .16s ease, border-color .16s ease;
  }
  .ora-category-head:hover { background: #ecf6ed; }
  .ora-category-head[aria-expanded="true"] { border-left-color: #d3aa43; background: #edf6ee; }
  .ora-category-head > span {
    display: grid;
    place-items: center;
    width: 27px;
    height: 27px;
    border-radius: 7px;
    background: #1f613b;
    color: #fff;
    font: 800 11px/1 "IBM Plex Mono", ui-monospace, monospace;
  }
  .ora-category-head strong { font-size: 13.5px; }
  .ora-category-head small { color: #55745c; font-size: 11px; }
  .ora-category-head i { color: #2f6e48; font-size: 21px; font-style: normal; line-height: 1; }
  .ora-category-body { padding: 10px 12px; border-top: 1px solid #dce8dc; background: #fffefa; }
  .ora-item {
    display: grid;
    grid-template-columns: minmax(220px, 1.35fr) minmax(175px, .85fr) minmax(195px, 1fr);
    gap: 13px;
    align-items: start;
    padding: 15px 8px;
    border-bottom: 1px solid #e0e9df;
  }
  .ora-item:last-child { border-bottom: 0; }
  .ora-item-title { display: flex; gap: 9px; }
  .ora-item-title > span { flex: 0 0 auto; color: #9a741e; font: 800 10.5px/1.5 "IBM Plex Mono", ui-monospace, monospace; }
  .ora-item-title p { margin: 0; color: #293e30; font-size: 13px; line-height: 1.5; }
  .ora-question { display: grid; gap: 7px; }
  .ora-question b { color: #426049; font-size: 10.5px; line-height: 1.28; }
  .ora-question > div { display: flex; gap: 7px; }
  .ora-choice {
    min-height: 40px;
    flex: 1;
    border: 1px solid #b9cbbb;
    border-radius: 8px;
    background: #fff;
    color: #36523c;
    font: 800 12px/1 Inter, Arial, sans-serif;
    cursor: pointer;
    transition: transform .12s ease, background .12s ease, border-color .12s ease;
  }
  .ora-choice:hover { transform: translateY(-1px); border-color: #7fa484; }
  .ora-choice--risk.is-selected, .ora-choice--action.is-selected { border-color: #ae4637; background: #fff0ed; color: #862b22; }
  .ora-choice--safe.is-selected { border-color: #2b7747; background: #e8f5e9; color: #1f6038; }
  .ora-note { grid-column: 2 / -1; }
  .ora-submit {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 10px;
    flex-wrap: wrap;
    margin-top: 20px;
    padding: 17px;
    border: 1px solid #235d39;
    border-radius: 13px;
    background: linear-gradient(120deg, #0e3924, #185637);
    box-shadow: 0 12px 28px -23px rgba(7, 37, 22, .7);
  }
  .ora-submit p { flex: 1 1 280px; margin: 0; color: #e5f1e6; font-size: 12.5px; line-height: 1.45; }
  .ora-button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 7px;
    min-height: 44px;
    border: 1px solid #e7c979;
    border-radius: 8px;
    padding: 10px 15px;
    background: #e7c979;
    color: #1c3826;
    font: 800 13px/1 Inter, Archivo, Arial, sans-serif;
    cursor: pointer;
  }
  .ora-button:hover { background: #f0d885; border-color: #f0d885; }
  .ora-button:disabled { opacity: .63; cursor: wait; }
  .ora-button--secondary { border-color: rgba(255,255,255,.48); background: rgba(255,255,255,.08); color: #fffdf5; }
  .ora-button--secondary:hover { border-color: #fff3bd; background: rgba(255,255,255,.14); color: #fffdf5; }
  .ora-confirm {
    max-width: 640px;
    margin-top: 42px;
    border: 1px solid #22583a;
    border-radius: 17px;
    padding: 38px 32px;
    background: linear-gradient(135deg, #0b2c1b, #164b2f);
    box-shadow: 0 22px 52px -26px rgba(8, 36, 22, .72);
    color: #f2f7ef;
    text-align: center;
  }
  .ora-confirm > svg { color: #e7c979; }
  .ora-confirm h1 { color: #fffdf5; font-size: clamp(25px, 3.5vw, 32px); }
  .ora-confirm p { color: #e0ebdf; }
  .ora-actions { display: flex; justify-content: center; gap: 10px; flex-wrap: wrap; margin-top: 20px; }
  .ora-confirm .ora-button--secondary { border-color: rgba(255,255,255,.43); }
  @media (max-width: 820px) {
    .ora-details-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .ora-item { grid-template-columns: 1fr 1fr; }
    .ora-item-title { grid-column: 1 / -1; }
    .ora-note { grid-column: 1 / -1; }
  }
  @media (max-width: 560px) {
    .ora { padding: 14px 10px 52px; }
    .ora-hero { padding: 21px 19px; }
    .ora-hero > svg { display: none; }
    .ora-details-grid, .ora-item { grid-template-columns: 1fr; }
    .ora-section > header { flex-wrap: wrap; padding: 13px; }
    .ora-progress { margin-left: 0; }
    .ora-category-head { grid-template-columns: 28px minmax(0, 1fr) 18px; }
    .ora-category-head small { grid-column: 2; }
    .ora-category-head i { grid-row: 1 / 3; grid-column: 3; }
    .ora-question > div { gap: 8px; }
    .ora-choice { min-height: 44px; }
    .ora-submit { align-items: stretch; flex-direction: column; }
    .ora-submit .ora-button { width: 100%; }
    .ora-confirm { margin: 24px 0 0; padding: 30px 20px; }
  }
  @media print {
    .ora-back, .ora-submit, .ora-category-head i { display: none !important; }
    .ora { padding: 0; color: #000; }
    .ora-section { break-inside: avoid; box-shadow: none; }
    .ora-category-body { display: block !important; }
    .ora-item { grid-template-columns: 1fr 1fr; }
    .ora-note { grid-column: 1 / -1; }
  }
`;
