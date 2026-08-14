// dsh-billing — browser half.
// Registers a "消耗" tab (conversation.view) with summary cards, a per-model
// donut, per-turn cost bars + cumulative line, and an expandable turn/step list.
// Charts are hand-rolled SVG (no chart library is available in the DSH client).
window.__ModuleLoader__.load({
  id: "@deepseek-ai/dsh-billing",
  factory: function (require) {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

    var react = require("react");
    var jsxRuntime = require("react/jsx-runtime");
    var jsx = jsxRuntime.jsx;

    var inject = ["slots"];

    // ---------- formatting helpers ----------
    function fmtAmount(amount, currency, decimals) {
      var sym = currency === "CNY" ? "¥" : "$";
      var d = typeof decimals === "number" ? decimals : 4;
      var threshold = Math.pow(10, -d);
      if (amount > 0 && amount < threshold) return "< " + sym + threshold.toFixed(d);
      return sym + amount.toFixed(d);
    }
    function fmtCost(billing) {
      return fmtAmount(billing.cost, billing.currency, billing.displayDecimals);
    }
    function fmtTokens(n) {
      n = n || 0;
      if (n >= 1000000) {
        var m = n / 1000000;
        return (m >= 10 ? m.toFixed(0) : m.toFixed(1)) + "M";
      }
      if (n >= 1000) {
        var k = n / 1000;
        return (k >= 10 ? k.toFixed(0) : k.toFixed(1)) + "K";
      }
      return String(n);
    }
    function shortModel(mk) {
      var i = mk.indexOf("/");
      return i >= 0 ? mk.slice(i + 1) : mk;
    }
    function fmtShort(amount, currency) {
      var sym = currency === "CNY" ? "¥" : "$";
      if (amount === 0) return sym + "0";
      var s;
      if (amount >= 100) s = amount.toFixed(0);
      else if (amount >= 1) s = amount.toFixed(1);
      else if (amount >= 0.01) s = amount.toFixed(3);
      else s = amount.toExponential(1);
      if (s.indexOf(".") >= 0) s = s.replace(/0+$/, "").replace(/\.$/, "");
      return sym + s;
    }
    function xTickIndices(n) {
      var out = [];
      if (n <= 12) {
        for (var i = 0; i < n; i++) out.push(i);
        return out;
      }
      var step = Math.ceil(n / 8);
      for (var j = 0; j < n; j += step) out.push(j);
      if (out[out.length - 1] !== n - 1) out.push(n - 1);
      return out;
    }
    function hoverTooltip(hover) {
      if (!hover) return null;
      return jsx("div", {
        style: {
          position: "absolute",
          left: hover.x,
          top: hover.y,
          transform: "translate(-50%, calc(-100% - 10px))",
          pointerEvents: "none",
          background: "rgba(17,24,39,0.92)",
          color: "#fff",
          borderRadius: 8,
          padding: "8px 10px",
          fontSize: 12,
          lineHeight: "18px",
          whiteSpace: "nowrap",
          zIndex: 20,
          boxShadow: "0 4px 12px rgba(0,0,0,0.25)",
        },
        children: hover.content,
      });
    }

    var PEAK_COLOR = "#f59e0b";
    var OFFPEAK_COLOR = "#38bdf8";
    var LINE_COLOR = "#10b981";
    var PALETTE = ["#f59e0b", "#38bdf8", "#a78bfa", "#34d399", "#f472b6"];

    // ---------- 1. summary cards ----------
    function SummaryCards(props) {
      var b = props.billing;
      var cards = [
        { label: "总花费", value: fmtCost(b) },
        { label: "输入(未命中)", value: fmtTokens(b.inputTokens) },
        { label: "缓存命中", value: fmtTokens(b.cacheReadTokens) },
        { label: "输出", value: fmtTokens(b.outputTokens) },
      ];
      var children = cards.map(function (c) {
        return jsx(
          "div",
          {
            key: c.label,
            style: { border: "1px solid rgba(128,128,128,0.3)", borderRadius: 8, padding: "10px 14px", minWidth: 110 },
            children: [
              jsx("div", { style: { fontSize: 11, opacity: 0.6, marginBottom: 4 }, children: c.label }),
              jsx("div", { style: { fontSize: 16, fontWeight: 600 }, children: c.value }),
            ],
          }
        );
      });
      return jsx("div", { style: { display: "flex", flexWrap: "wrap", gap: 10 }, children: children });
    }

    // ---------- 3. per-model donut ----------
    function Donut(props) {
      var perModel = props.perModel || {};
      var keys = Object.keys(perModel);
      var total = 0;
      keys.forEach(function (k) { total += perModel[k].cost; });
      var R = 40;
      var C = 2 * Math.PI * R;
      var offset = 0;
      var segs = [];
      var hoverSt = react.useState(null);
      var hover = hoverSt[0];
      var setHover = hoverSt[1];
      var wrapRef = react.useRef(null);

      function onMove(e, k) {
        var rect = wrapRef.current.getBoundingClientRect();
        var m = perModel[k];
        var share = total > 0 ? Math.round((m.cost / total) * 1000) / 10 : 0;
        setHover({
          x: e.clientX - rect.left,
          y: e.clientY - rect.top,
          content: jsx("div", { children: [
            jsx("div", { style: { fontWeight: 600 }, children: shortModel(k) }),
            jsx("div", { children: "花费 " + fmtAmount(m.cost, props.currency, props.decimals) }),
            jsx("div", { children: "占比 " + share + "%" }),
            jsx("div", { style: { opacity: 0.8 }, children: "入" + fmtTokens(m.inputTokens) + " · 缓存" + fmtTokens(m.cacheReadTokens) + " · 出" + fmtTokens(m.outputTokens) }),
          ] }),
        });
      }

      if (total > 0) {
        keys.forEach(function (k, i) {
          var frac = perModel[k].cost / total;
          var len = frac * C;
          segs.push(
            jsx("circle", {
              key: k,
              cx: 50,
              cy: 50,
              r: R,
              fill: "none",
              stroke: PALETTE[i % PALETTE.length],
              strokeWidth: 14,
              strokeDasharray: len + " " + (C - len),
              strokeDashoffset: -offset,
              onMouseMove: function (e) { onMove(e, k); },
              onMouseLeave: function () { setHover(null); },
            })
          );
          offset += len;
        });
      }
      return jsx(
        "div",
        { ref: wrapRef, style: { position: "relative" }, children: [
          jsx(
            "svg",
            { width: 100, height: 100, viewBox: "0 0 100 100", children: [
              jsx("circle", { cx: 50, cy: 50, r: R, fill: "none", stroke: "rgba(128,128,128,0.2)", strokeWidth: 14 }),
              segs,
            ] }
          ),
          hoverTooltip(hover),
        ] }
      );
    }

    function ModelBreakdown(props) {
      var b = props.billing;
      var keys = Object.keys(b.perModel || {});
      if (keys.length === 0) return null;
      var rows = keys.map(function (k) {
        var m = b.perModel[k];
        return jsx(
          "div",
          { key: k, style: { display: "flex", justifyContent: "space-between", gap: 20, fontSize: 12, padding: "2px 0" }, children: [
            jsx("span", { children: shortModel(k) }),
            jsx("span", { style: { opacity: 0.6 }, children: "入" + fmtTokens(m.inputTokens) + " · 缓存" + fmtTokens(m.cacheReadTokens) + " · 出" + fmtTokens(m.outputTokens) }),
            jsx("span", { style: { fontWeight: 600 }, children: fmtAmount(m.cost, b.currency, b.displayDecimals) }),
          ] }
        );
      });
      return jsx(
        "div",
        { style: { display: "flex", alignItems: "center", gap: 16, border: "1px solid rgba(128,128,128,0.3)", borderRadius: 8, padding: 12 }, children: [
          jsx(Donut, { perModel: b.perModel, currency: b.currency, decimals: b.displayDecimals }),
          jsx("div", { style: { flex: 1 }, children: [
            jsx("div", { style: { fontSize: 11, opacity: 0.6, marginBottom: 6 }, children: "按模型" }),
            rows,
          ] }),
        ] }
      );
    }

    // ---------- 4. per-turn cost bars (peak/off-peak stacked) ----------
    function CostBars(props) {
      var turns = props.turns || [];
      if (turns.length === 0) return null;
      var W = 720;
      var H = 240;
      var padL = 52;
      var padR = 8;
      var padT = 24;
      var padB = 24;
      var innerW = W - padL - padR;
      var innerH = H - padT - padB;
      var max = 0;
      turns.forEach(function (t) { if (t.cost > max) max = t.cost; });
      if (max <= 0) max = 1;
      var band = innerW / turns.length;
      var barW = Math.max(2, Math.min(30, band * 0.7));

      var hoverSt = react.useState(null);
      var hover = hoverSt[0];
      var setHover = hoverSt[1];
      var wrapRef = react.useRef(null);

      function onMove(e, t) {
        var rect = wrapRef.current.getBoundingClientRect();
        var model = t.model ? shortModel(t.model) : "多模型";
        setHover({
          x: e.clientX - rect.left,
          y: e.clientY - rect.top,
          content: jsx("div", { children: [
            jsx("div", { style: { fontWeight: 600 }, children: "轮 " + t.turn + " · " + model }),
            jsx("div", { children: "高峰 " + fmtAmount(t.peakCost, props.currency, props.decimals) }),
            jsx("div", { children: "空闲 " + fmtAmount(t.offPeakCost, props.currency, props.decimals) }),
            jsx("div", { style: { fontWeight: 600 }, children: "合计 " + fmtAmount(t.cost, props.currency, props.decimals) }),
            jsx("div", { style: { opacity: 0.8 }, children: "输入 " + fmtTokens(t.inputTokens) + " · 缓存 " + fmtTokens(t.cacheReadTokens) + " · 输出 " + fmtTokens(t.outputTokens) + (t.reasoningTokens ? " · 推理 " + fmtTokens(t.reasoningTokens) : "") }),
          ] }),
        });
      }

      var yTicks = [0, max / 2, max];
      var grid = yTicks.map(function (v) {
        var y = padT + innerH * (1 - v / max);
        return jsx(
          "g",
          { key: "y" + v, children: [
            jsx("line", { x1: padL, y1: y, x2: W - padR, y2: y, stroke: "rgba(128,128,128,0.2)", strokeWidth: 1 }),
            jsx("text", { x: padL - 6, y: y + 3, fontSize: 10, textAnchor: "end", opacity: 0.6, children: fmtShort(v, props.currency) }),
          ] }
        );
      });

      var bars = turns.map(function (t, i) {
        var x = padL + band * i + (band - barW) / 2;
        var hPeak = innerH * (t.peakCost / max);
        var hOff = innerH * (t.offPeakCost / max);
        var yOff = padT + innerH - hOff;
        var yPeak = yOff - hPeak;
        return jsx(
          "g",
          { key: t.turn, children: [
            hOff > 0 ? jsx("rect", { x: x, y: yOff, width: barW, height: hOff, fill: OFFPEAK_COLOR }) : null,
            hPeak > 0 ? jsx("rect", { x: x, y: yPeak, width: barW, height: hPeak, fill: PEAK_COLOR }) : null,
          ] }
        );
      });

      var hitRects = turns.map(function (t, i) {
        return jsx("rect", {
          key: "hit" + i,
          x: padL + band * i,
          y: padT,
          width: band,
          height: innerH,
          fill: "transparent",
          onMouseMove: function (e) { onMove(e, t); },
          onMouseLeave: function () { setHover(null); },
        });
      });

      var xTicks = xTickIndices(turns.length).map(function (i) {
        var x = padL + band * i + band / 2;
        return jsx("text", { key: "x" + i, x: x, y: H - padB + 14, fontSize: 10, textAnchor: "middle", opacity: 0.6, children: String(turns[i].turn) });
      });

      var legend = jsx(
        "g",
        { children: [
          jsx("rect", { x: padL + 2, y: 6, width: 10, height: 10, fill: PEAK_COLOR }),
          jsx("text", { x: padL + 16, y: 14, fontSize: 10, opacity: 0.6, children: "高峰" }),
          jsx("rect", { x: padL + 56, y: 6, width: 10, height: 10, fill: OFFPEAK_COLOR }),
          jsx("text", { x: padL + 70, y: 14, fontSize: 10, opacity: 0.6, children: "空闲" }),
        ] }
      );

      return jsx(
        "div",
        { ref: wrapRef, style: { position: "relative" }, children: [
          jsx(
            "svg",
            { width: "100%", viewBox: "0 0 " + W + " " + H, style: { border: "1px solid rgba(128,128,128,0.25)", borderRadius: 8, background: "rgba(128,128,128,0.05)" }, children: [
              grid,
              bars,
              hitRects,
              xTicks,
              legend,
            ] }
          ),
          hoverTooltip(hover),
        ] }
      );
    }

    // ---------- 5. cumulative cost line ----------
    function CumulativeLine(props) {
      var turns = props.turns || [];
      if (turns.length < 2) return null;
      var W = 720;
      var H = 140;
      var padL = 52;
      var padR = 8;
      var padT = 8;
      var padB = 24;
      var innerW = W - padL - padR;
      var innerH = H - padT - padB;
      var total = props.billing.cost || 0;
      if (total <= 0) total = 1;

      var hoverSt = react.useState(null);
      var hover = hoverSt[0];
      var setHover = hoverSt[1];
      var wrapRef = react.useRef(null);

      function onMove(e, t, cum) {
        var rect = wrapRef.current.getBoundingClientRect();
        setHover({
          x: e.clientX - rect.left,
          y: e.clientY - rect.top,
          content: jsx("div", { children: [
            jsx("div", { style: { fontWeight: 600 }, children: "轮 " + t.turn }),
            jsx("div", { children: "累计 " + fmtAmount(cum, props.billing.currency, props.billing.displayDecimals) }),
            jsx("div", { style: { opacity: 0.8 }, children: "本轮 " + fmtAmount(t.cost, props.billing.currency, props.billing.displayDecimals) }),
          ] }),
        });
      }

      var yTicks = [0, total / 2, total];
      var grid = yTicks.map(function (v) {
        var y = padT + innerH * (1 - v / total);
        return jsx(
          "g",
          { key: "y" + v, children: [
            jsx("line", { x1: padL, y1: y, x2: W - padR, y2: y, stroke: "rgba(128,128,128,0.2)", strokeWidth: 1 }),
            jsx("text", { x: padL - 6, y: y + 3, fontSize: 10, textAnchor: "end", opacity: 0.6, children: fmtShort(v, props.billing.currency) }),
          ] }
        );
      });

      var pts = [];
      var acc = 0;
      var points = turns.map(function (t, i) {
        acc += t.cost;
        var cum = acc;
        var x = padL + innerW * (i / (turns.length - 1));
        var y = padT + innerH * (1 - acc / total);
        pts.push(x + "," + y);
        return jsx("circle", {
          key: "p" + i,
          cx: x,
          cy: y,
          r: 7,
          fill: "transparent",
          onMouseMove: function (e) { onMove(e, t, cum); },
          onMouseLeave: function () { setHover(null); },
        });
      });

      var xTicks = xTickIndices(turns.length).map(function (i) {
        var x = padL + innerW * (i / (turns.length - 1));
        return jsx("text", { key: "x" + i, x: x, y: H - padB + 14, fontSize: 10, textAnchor: "middle", opacity: 0.6, children: String(turns[i].turn) });
      });

      return jsx(
        "div",
        { ref: wrapRef, style: { position: "relative" }, children: [
          jsx(
            "svg",
            { width: "100%", viewBox: "0 0 " + W + " " + H, style: { border: "1px solid rgba(128,128,128,0.25)", borderRadius: 8, background: "rgba(128,128,128,0.05)" }, children: [
              grid,
              jsx("polyline", { points: pts.join(" "), fill: "none", stroke: LINE_COLOR, strokeWidth: 2 }),
              points,
              xTicks,
            ] }
          ),
          hoverTooltip(hover),
        ] }
      );
    }

    // ---------- 6. expandable turn/step list ----------
    function TurnRow(props) {
      var t = props.turn;
      var b = props.billing;
      var model = t.model ? shortModel(t.model) : "多模型";
      var head = jsx(
        "button",
        { onClick: props.onToggle, style: { display: "flex", gap: 12, alignItems: "center", width: "100%", padding: "8px 10px", border: "1px solid rgba(128,128,128,0.3)", borderRadius: 6, marginBottom: 4, background: "transparent", cursor: "pointer", font: "inherit", color: "inherit", textAlign: "left" }, children: [
          jsx("span", { style: { width: 14 }, children: props.expanded ? "▾" : "▸" }),
          jsx("span", { children: "轮 " + t.turn + " · " + model }),
          jsx("span", { style: { flex: 1, opacity: 0.6, fontSize: 12 }, children: "入" + fmtTokens(t.inputTokens) + " · 缓存" + fmtTokens(t.cacheReadTokens) + " · 出" + fmtTokens(t.outputTokens) }),
          t.peakCost > 0 && t.offPeakCost > 0 ? jsx("span", { style: { fontSize: 11, opacity: 0.6 }, children: "峰谷混合" }) : jsx("span", { style: { fontSize: 11, opacity: 0.6 }, children: t.peakCost > 0 ? "高峰" : "空闲" }),
          jsx("span", { style: { fontWeight: 600 }, children: fmtAmount(t.cost, b.currency, b.displayDecimals) }),
        ] }
      );
      var steps = null;
      if (props.expanded) {
        steps = jsx(
          "div",
          { style: { paddingLeft: 26, marginBottom: 6 }, children: t.steps.map(function (s) {
            return jsx(
              "div",
              { key: s.step, style: { display: "flex", gap: 12, alignItems: "center", padding: "3px 0", fontSize: 12, opacity: 0.85 }, children: [
                jsx("span", { children: "步 " + s.step + " · " + shortModel(s.model) }),
                jsx("span", { style: { flex: 1, opacity: 0.7 }, children: "入" + fmtTokens(s.inputTokens) + " · 缓存" + fmtTokens(s.cacheReadTokens) + " · 出" + fmtTokens(s.outputTokens) + (s.reasoningTokens ? " · 推理" + fmtTokens(s.reasoningTokens) : "") }),
                jsx("span", { children: s.peak ? "高峰" : "空闲" }),
                jsx("span", { style: { fontWeight: 600 }, children: fmtAmount(s.cost, b.currency, b.displayDecimals) }),
              ] }
            );
          }) }
        );
      }
      return jsx("div", { children: [head, steps] });
    }

    function TurnList(props) {
      var b = props.billing;
      var turns = b.turns || [];
      var st = react.useState(null);
      var expanded = st[0];
      var setExpanded = st[1];
      function toggle(turn) {
        setExpanded(expanded === turn ? null : turn);
      }
      var rows = turns.map(function (t) {
        return jsx(TurnRow, { key: t.turn, billing: b, turn: t, expanded: expanded === t.turn, onToggle: function () { toggle(t.turn); } });
      });
      return jsx("div", { children: [
        jsx("div", { style: { fontSize: 12, fontWeight: 600, opacity: 0.7, marginBottom: 8 }, children: "每轮消耗（点击展开步骤）" }),
        rows,
      ] });
    }

    // ---------- the "消耗" tab ----------
    function ConsumptionView(props) {
      var useProjection = props.useProjection;
      var billing = useProjection ? useProjection("billing") : undefined;
      var rootRef = react.useRef(null);
      react.useLayoutEffect(function () {
        if (rootRef.current) rootRef.current.scrollIntoView({ block: "start" });
      }, []);
      if (!billing) {
        return jsx("div", { style: { padding: 24, opacity: 0.6 }, children: "暂无消耗数据" });
      }
      var turns = billing.turns || [];
      return jsx(
        "div",
        { ref: rootRef, style: { padding: 16, display: "flex", flexDirection: "column", gap: 16, fontSize: 13, maxWidth: 860 }, children: [
          jsx(SummaryCards, { billing: billing }),
          jsx(ModelBreakdown, { billing: billing }),
          turns.length > 0 ? jsx("div", { children: [
            jsx("div", { style: { fontSize: 12, fontWeight: 600, opacity: 0.7, marginBottom: 6 }, children: "每轮花费（橙=高峰 · 蓝=空闲）" }),
            jsx(CostBars, { billing: billing, turns: turns, currency: billing.currency, decimals: billing.displayDecimals }),
            jsx("div", { style: { fontSize: 12, fontWeight: 600, opacity: 0.7, margin: "10px 0 6px" }, children: "累计花费" }),
            jsx(CumulativeLine, { billing: billing, turns: turns }),
          ] }) : null,
          jsx(TurnList, { billing: billing }),
        ] }
      );
    }

    // ---------- registration ----------
    function apply(ctx) {
      ctx.slots.inject("conversation.view", function () {
        return ctx.slots.register(
          { name: "conversation.view", id: "billing", order: 20, locale: "billing", label: function () { return "消耗"; } },
          ConsumptionView
        );
      });
    }

    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  },
});
