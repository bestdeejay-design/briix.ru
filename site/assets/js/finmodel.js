/* ============================================================
   BRIIX — interactive unit-economics calculator
   ============================================================ */
(function () {
  'use strict';

  const els = {
    clients: document.getElementById('s-clients'),
    arpa: document.getElementById('s-arpa'),
    churn: document.getElementById('s-churn'),
    cac: document.getElementById('s-cac'),
    cogs: document.getElementById('s-cogs'),
    fixed: document.getElementById('s-fixed'),
    mkt: document.getElementById('s-mkt'),
  };

  const out = {
    vClients: document.getElementById('v-clients'),
    vArpa: document.getElementById('v-arpa'),
    vChurn: document.getElementById('v-churn'),
    vCac: document.getElementById('v-cac'),
    vCogs: document.getElementById('v-cogs'),
    vFixed: document.getElementById('v-fixed'),
    vMkt: document.getElementById('v-mkt'),
    margin: document.getElementById('r-margin'),
    gpc: document.getElementById('r-gpc'),
    ltv: document.getElementById('r-ltv'),
    lifespan: document.getElementById('r-lifespan'),
    ltvcac: document.getElementById('r-ltvcac'),
    payback: document.getElementById('r-payback'),
    breakeven: document.getElementById('r-breakeven'),
    mrr: document.getElementById('r-mrr'),
    note: document.getElementById('r-note'),
  };

  if (!els.clients || !out.margin) return;

  const I18N = window.I18N || {};
  const FIN = I18N.fin || {};
  const LOCALE = I18N.locale || 'en-US';
  const fmtMoney = (n) =>
    '$' + Math.round(n).toLocaleString(LOCALE).replace(/,/g, ' ');
  const fmtNum = (n, digits) =>
    n.toLocaleString(LOCALE, { minimumFractionDigits: digits, maximumFractionDigits: digits }).replace(/,/g, ' ');

  function compute() {
    const clients = +els.clients.value;
    const arpa = +els.arpa.value;
    const churnPct = +els.churn.value;
    const cac = +els.cac.value;
    const cogs = +els.cogs.value;
    const fixed = +els.fixed.value;
    const mkt = +els.mkt.value;

    const churn = churnPct / 100;
    const grossPerClient = arpa - cogs;
    const margin = arpa > 0 ? (grossPerClient / arpa) * 100 : 0;
    const lifespan = churn > 0 ? Math.round(1 / churn) : 999;
    const ltv = grossPerClient * lifespan;
    const ltvcac = cac > 0 ? ltv / cac : 0;
    const payback = grossPerClient > 0 ? cac / grossPerClient : 999;
    const breakeven = grossPerClient > 0 ? (fixed + mkt) / grossPerClient : 999;
    const mrr = clients * arpa;
    const op = clients * grossPerClient - fixed - mkt;

    out.vClients.textContent = clients.toLocaleString(LOCALE).replace(/,/g, ' ');
    out.vArpa.textContent = '$' + arpa;
    out.vChurn.textContent = fmtNum(churnPct, churnPct % 1 ? 1 : 0) + '%';
    out.vCac.textContent = '$' + cac;
    out.vCogs.textContent = '$' + fmtNum(cogs, 1);
    out.vFixed.textContent = fmtMoney(fixed);
    out.vMkt.textContent = fmtMoney(mkt);

    out.margin.textContent = fmtNum(margin, 1) + '%';
    out.gpc.textContent = fmtMoney(grossPerClient);
    out.ltv.textContent = fmtMoney(ltv);
    out.lifespan.textContent = (FIN.life || 'life') + ' ' + fmtNum(lifespan, 1) + ' ' + (FIN.months || 'mo');
    out.ltvcac.textContent = fmtNum(ltvcac, 1);
    out.payback.textContent = fmtNum(Math.min(payback, 99), 1) + ' ' + (FIN.months || 'mo');
    out.breakeven.textContent = Math.ceil(breakeven).toLocaleString(LOCALE).replace(/,/g, ' ');
    out.mrr.textContent = fmtMoney(mrr) + ' · ' + (op >= 0 ? '+' : '−') + fmtMoney(Math.abs(op));
    out.mrr.classList.toggle('up', op >= 0);
    out.mrr.classList.toggle('down', op < 0);

    if (clients >= breakeven) {
      out.note.textContent = FIN.breakevenOk || 'breakeven reached';
    } else {
      out.note.textContent = (FIN.breakevenGap || 'need') + ' ' +
        Math.ceil(breakeven - clients).toLocaleString(LOCALE).replace(/,/g, ' ') + ' ' + (FIN.clients || 'more clients');
    }
  }

  Object.values(els).forEach((input) => {
    if (input) input.addEventListener('input', compute);
  });

  compute();
})();
