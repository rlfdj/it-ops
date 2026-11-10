import { SHORTCUT_GROUPS } from "@/lib/shortcut-list";

/** The keyboard bindings, grouped. Used in the "?" sheet and on the Settings page. */
export function ShortcutsList() {
  return (
    <div className="grid grid-cols-2 gap-x-8 gap-y-5 max-[760px]:grid-cols-1">
      {SHORTCUT_GROUPS.map((g) => (
        <section key={g.title} aria-label={g.title} className="flex flex-col gap-1.5">
          <h3 className="lbl m-0">{g.title}</h3>
          <dl className="m-0 flex flex-col gap-1.5">
            {g.items.map((i) => (
              <div key={i.label} className="flex items-center justify-between gap-3">
                <dt className="text-ink2">{i.label}</dt>
                <dd className="m-0 flex gap-1">
                  {i.keys.map((k) => (
                    <span key={k} className="kbd">
                      {k}
                    </span>
                  ))}
                </dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
    </div>
  );
}
