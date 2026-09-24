import { useState } from "react";
import { api, type CostBreakdown } from "../api.ts";
import { money, useApp } from "../context.tsx";
import { useT } from "../i18n.ts";

export function PricesPage() {
  const t = useT();
  const { config, toast } = useApp();
  const s = config?.settings;
  const [form, setForm] = useState({
    grams: 50,
    hours: 2.5,
    materialId: s?.defaultMaterial ?? "PLA",
    printerId: s?.defaultPrinterProfile ?? "generic",
    filamentPricePerKg: s?.filamentPricePerKg ?? ("" as number | ""),
    electricityPerKwh: s?.electricityPerKwh ?? 0.15,
    laborMinutes: 10,
    laborPerHour: s?.laborPerHour ?? 5,
    platformFeePercent: s?.platformFeePercent ?? 0,
    taxPercent: 0,
    marginPercent: s?.marginPercent ?? 40,
  });
  const [result, setResult] = useState<CostBreakdown | null>(null);
  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: k === "materialId" || k === "printerId" ? v : v === "" ? "" : Number(v) }));
  const currency = s?.currency ?? "USD";

  const calc = async () => {
    try {
      const { hours, filamentPricePerKg, ...rest } = form;
      setResult(await api.price({ ...rest, printSeconds: hours * 3600, filamentPricePerKg: filamentPricePerKg === "" ? undefined : filamentPricePerKg }));
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };

  const refPrice = config?.materials.find((m) => m.id === form.materialId)?.pricePerKg;
  const num = (k: keyof typeof form, label: string, step = "any") => (
    <label className="field">
      <span>{label}</span>
      <input className="input" type="number" min={0} step={step} placeholder={k === "filamentPricePerKg" && refPrice ? `${refPrice} (ref.)` : undefined} value={form[k] as number | ""} onChange={(e) => set(k, e.target.value)} />
    </label>
  );

  return (
    <div className="page">
      <div className="page-narrow">
        <div className="page-head">
          <div>
            <h1>{t("prices.title")}</h1>
            <p className="muted" style={{ margin: "4px 0 0" }}>{t("prices.desc")}</p>
          </div>
        </div>
        <div className="grid-2" style={{ alignItems: "start" }}>
          <div className="card">
            <div className="grid-2">
              {num("grams", t("prices.grams"))}
              {num("hours", t("prices.hours"))}
              <label className="field">
                <span>{t("prices.material")}</span>
                <select className="input" value={form.materialId} onChange={(e) => set("materialId", e.target.value)}>
                  {config?.materials.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                </select>
              </label>
              <label className="field">
                <span>{t("prices.printer")}</span>
                <select className="input" value={form.printerId} onChange={(e) => set("printerId", e.target.value)}>
                  {config?.printerProfiles.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </label>
              {num("filamentPricePerKg", `${t("prices.filament")} (${currency})`)}
              {num("electricityPerKwh", `${t("prices.electricity")} (${currency})`)}
              {num("laborMinutes", t("prices.labor"), "1")}
              {num("laborPerHour", `${t("prices.laborRate")} (${currency})`)}
              {num("platformFeePercent", t("prices.fee"))}
              {num("taxPercent", t("prices.tax"))}
              {num("marginPercent", t("prices.margin"), "1")}
            </div>
            <button className="btn btn-primary" style={{ marginTop: 14, width: "100%" }} onClick={() => void calc()}>{t("prices.calc")}</button>
          </div>

          {result && (
            <div className="card">
              <div className="small muted">{t("prices.suggested")}</div>
              <div className="price-big">{money(result.suggestedPrice, result.currency)}</div>
              <div className="stats stats-3" style={{ margin: "12px 0" }}>
                <div className="stat"><div className="k">{t("prices.total")}</div><div className="v">{money(result.totalCost, result.currency)}</div></div>
                <div className="stat"><div className="k">{t("prices.profit")}</div><div className="v">{money(result.profit, result.currency)}</div></div>
                <div className="stat"><div className="k">{t("prices.breakEven")}</div><div className="v">{money(result.breakEvenPrice, result.currency)}</div></div>
              </div>
              <table className="table">
                <tbody>
                  {([["Material", result.material], ["Electricidad", result.electricity], ["Desgaste de la máquina", result.depreciation], ["Mantenimiento", result.maintenance], ["Trabajo", result.labor], ["Colchón por fallos", result.failureBuffer], ["Empaque", result.packaging]] as const).map(([k, v]) => (
                    <tr key={k}><td>{k}</td><td className="num">{money(v, result.currency)}</td></tr>
                  ))}
                </tbody>
              </table>
              <h3 style={{ marginTop: 14 }}>Niveles de precio</h3>
              <table className="table">
                <tbody>
                  {result.tiers.map((tier) => <tr key={tier.name}><td>{tier.name}</td><td className="num muted">+{tier.marginPercent}%</td><td className="num"><b>{money(tier.price, result.currency)}</b></td></tr>)}
                </tbody>
              </table>
              <ul className="small muted" style={{ paddingLeft: 18 }}>
                {result.explanation.map((e) => <li key={e}>{e}</li>)}
              </ul>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
