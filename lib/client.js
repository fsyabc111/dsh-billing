// dsh-billing — browser half.
// Renders a live session-cost line in the conversation composer dock, next to
// the token StatsLine, reading the `billing` projection via useProjection.
window.__ModuleLoader__.load({
  id: "@deepseek-ai/dsh-billing",
  factory: function (require) {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

    var jsxRuntime = require("react/jsx-runtime");

    var inject = ["slots"];

    function formatCost(billing) {
      if (!billing) return null;
      var sym = billing.currency === "CNY" ? "¥" : "$";
      var decimals = typeof billing.displayDecimals === "number" ? billing.displayDecimals : 4;
      var threshold = Math.pow(10, -decimals);
      var amount = billing.cost;
      if (amount > 0 && amount < threshold) {
        return "< " + sym + threshold.toFixed(decimals);
      }
      return sym + amount.toFixed(decimals);
    }

    function BillingCostLine(props) {
      var useProjection = props.useProjection;
      var billing = useProjection ? useProjection("billing") : undefined;
      if (billing === undefined) return null;
      var text = formatCost(billing);
      if (text === null) return null;
      return jsxRuntime.jsx("span", {
        className: "dsh-billing-cost",
        title: "Session cost",
        children: text,
      });
    }

    function apply(ctx) {
      ctx.slots.inject("conversation.composer.dock", function () {
        return ctx.slots.register(
          {
            name: "conversation.composer.dock",
            id: "billing",
            order: 1,
            locale: "billing",
          },
          BillingCostLine
        );
      });
    }

    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  },
});
