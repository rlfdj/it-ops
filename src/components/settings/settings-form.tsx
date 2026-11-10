"use client";

import { useId, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Field, fieldProps } from "@/components/form-dialog";
import { useToast } from "@/components/shell/toast";
import { AppMark } from "@/components/shell/logo";
import { checkUpload } from "@/lib/uploads";
import {
  BASE_CURRENCIES,
  LOGO_ACCEPT,
  LOGO_RULES,
  logoUrl,
  timeZoneOptions,
  type WorkspaceSettings,
} from "@/lib/workspace";
import { removeLogo, saveWorkspaceSettings, uploadLogo } from "@/app/(app)/settings/actions";

export function SettingsForm({ settings }: { settings: WorkspaceSettings }) {
  const router = useRouter();
  const toast = useToast();
  const ids = useId();
  const fileInput = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(settings.workspaceName);
  const [rate, setRate] = useState(String(settings.usdAedRate));
  const [currency, setCurrency] = useState(settings.baseCurrency);
  const [timeZone, setTimeZone] = useState(settings.timeZone);
  const [errors, setErrors] = useState<{ name?: string; rate?: string }>({});
  const [error, setError] = useState<string | null>(null);
  const [logoError, setLogoError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [logoPending, startLogo] = useTransition();
  const [zones] = useState(timeZoneOptions);

  const usdBase = currency === "USD";
  const currencyChanged = currency !== settings.baseCurrency;
  const dirty =
    name !== settings.workspaceName ||
    (!usdBase && Number(rate) !== settings.usdAedRate) ||
    currencyChanged ||
    timeZone !== settings.timeZone;
  const customLogo = logoUrl(settings.logoPath);
  const known = BASE_CURRENCIES.some((c) => c.code === currency);

  return (
    <div className="flex flex-col gap-4">
      <form
        className="flex flex-col gap-4"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          const found: typeof errors = {};
          if (!name.trim()) found.name = "Give the workspace a name.";
          const n = Number(rate);
          if (!usdBase && (!rate.trim() || !Number.isFinite(n) || n <= 0)) {
            found.rate = "Enter the exchange rate as a number above zero.";
          }
          setErrors(found);
          if (found.name || found.rate) return;
          setError(null);
          startTransition(async () => {
            const result = await saveWorkspaceSettings({
              workspaceName: name,
              usdAedRate: usdBase ? String(settings.usdAedRate) : rate,
              baseCurrency: currency,
              timeZone,
            });
            if (!result.ok) return setError(result.error);
            router.refresh();
            toast.show({ text: "Settings saved" });
          });
        }}
      >
        <Field label="Workspace name" htmlFor={`${ids}-name`} error={errors.name}>
          <input
            id={`${ids}-name`}
            className="field"
            value={name}
            maxLength={60}
            onChange={(e) => setName(e.target.value)}
            {...fieldProps(`${ids}-name`, errors.name)}
          />
        </Field>

        <Field
          label="Base currency"
          htmlFor={`${ids}-currency`}
          hint="Every amount in the app is shown in this currency."
        >
          <select
            id={`${ids}-currency`}
            className="field"
            value={currency}
            onChange={(e) => setCurrency(e.target.value)}
          >
            {known ? null : <option value={currency}>{currency}</option>}
            {BASE_CURRENCIES.map((c) => (
              <option key={c.code} value={c.code}>
                {c.code} · {c.name}
              </option>
            ))}
          </select>
        </Field>
        {currencyChanged ? (
          <p className="alert amber sm" role="status">
            Amounts already saved are not converted. Purchases, subscriptions and invoices keep
            their numbers and will be shown as {currency} amounts. Change the base currency before
            you enter data, or re-enter the amounts that matter.
          </p>
        ) : null}

        {usdBase ? null : (
          <Field
            label={`USD to ${currency} rate`}
            htmlFor={`${ids}-rate`}
            hint={`${currency} per 1 USD, used to convert USD charges and invoices entered from now on.`}
            error={errors.rate}
          >
            <input
              id={`${ids}-rate`}
              className="field"
              inputMode="decimal"
              value={rate}
              onChange={(e) => setRate(e.target.value)}
              {...fieldProps(`${ids}-rate`, errors.rate)}
            />
          </Field>
        )}

        <Field
          label="Time zone"
          htmlFor={`${ids}-tz`}
          hint="Dates, today, due dates, invoice periods and the activity log follow this zone."
        >
          <select
            id={`${ids}-tz`}
            className="field"
            value={timeZone}
            onChange={(e) => setTimeZone(e.target.value)}
          >
            {zones.includes(timeZone) ? null : <option value={timeZone}>{timeZone}</option>}
            {zones.map((z) => (
              <option key={z} value={z}>
                {z.replace(/_/g, " ")}
              </option>
            ))}
          </select>
        </Field>

        {error ? (
          <p className="alert red sm" role="alert">
            {error}
          </p>
        ) : null}
        <div>
          <Button type="submit" variant="primary" disabled={pending || !dirty}>
            {pending ? "Saving…" : "Save settings"}
          </Button>
        </div>
      </form>

      <div className="fieldset">
        <span className="lbl" id={`${ids}-logo-label`}>
          Logo
        </span>
        <div
          className="top flex items-center rounded-md px-3"
          style={{ height: 48, position: "static", width: "fit-content", maxWidth: "100%" }}
        >
          <span className="wordmark">
            <AppMark name={name || settings.workspaceName} logoSrc={customLogo} />
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={fileInput}
            type="file"
            hidden
            accept={LOGO_ACCEPT}
            aria-labelledby={`${ids}-logo-label`}
            data-testid="logo-file"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (!file) return;
              const problem = checkUpload(file, LOGO_RULES);
              if (problem) return setLogoError(problem);
              setLogoError(null);
              const body = new FormData();
              body.set("file", file);
              startLogo(async () => {
                const result = await uploadLogo(body);
                if (!result.ok) return setLogoError(result.error);
                router.refresh();
                toast.show({ text: "Logo updated" });
              });
            }}
          />
          <Button type="button" disabled={logoPending} onClick={() => fileInput.current?.click()}>
            {logoPending ? "Uploading…" : customLogo ? "Replace logo" : "Upload logo"}
          </Button>
          {customLogo ? (
            <Button
              type="button"
              variant="ghost"
              disabled={logoPending}
              onClick={() =>
                startLogo(async () => {
                  const result = await removeLogo();
                  if (!result.ok) return setLogoError(result.error);
                  setLogoError(null);
                  router.refresh();
                  toast.show({ text: "Logo removed" });
                })
              }
            >
              Remove logo
            </Button>
          ) : null}
        </div>
        {logoError ? (
          <p className="alert red sm" role="alert">
            {logoError}
          </p>
        ) : (
          <span className="cap">
            PNG, SVG or JPG, up to 1 MB. It is shown exactly as uploaded, at the height of the app
            bar and on the login page, never recoloured. The bar is dark, so use a logo that reads
            on a dark background (light or transparent). Without one, the default mark is used.
          </span>
        )}
      </div>
    </div>
  );
}
