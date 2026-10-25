"use client";
import { Camera } from "lucide-react";
import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { browserClient } from "@/lib/supabase";
import {
  Package,
  Plus,
  Search,
  LogOut,
  ArrowDownRight,
  ArrowUpRight,
  History,
  MapPin,
  ImagePlus,
  Trash2,
  Boxes,
  Download,
} from "lucide-react";
import { FileSpreadsheet } from "lucide-react";
type Item = {
  id: string;
  name: string;
  sku: string | null;
  category: string;
  location: string;
  description: string;
  quantity: number;
  image_url?: string;
  created_by?: string | null;
  created_by_email?: string;
  created_at?: string;
};
type Movement = {
  id: number;
  delta: number;
  note: string;
  created_at: string;
  items: { name: string } | null;
};
// Komprimer produktbilder i nettleseren før opplasting.
async function compressProductImage(file: File): Promise<File> {
  const targetBytes = 500 * 1024; // 500 KB
  const supported = ["image/jpeg", "image/png", "image/webp"];
  if (!supported.includes(file.type)) {
    throw new Error(
      "Velg et JPG-, PNG- eller WebP-bilde. HEIC må først konverteres til JPG."
    );
  }
  const image = await createImageBitmap(file).catch(() => {
    throw new Error(
      "Bildet kunne ikke åpnes. Prøv et annet bilde eller konverter til JPG."
    );
  });
  try {
    let scale = Math.min(1, 1600 / Math.max(image.width, image.height));
    for (let attempt = 0; attempt < 12; attempt++) {
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(image.width * scale));
      canvas.height = Math.max(1, Math.round(image.height * scale));
      const context = canvas.getContext("2d");
      if (!context)
        throw new Error("Bildet kunne ikke behandles i nettleseren.");
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      const quality = Math.max(0.4, 0.85 - (attempt % 4) * 0.12);
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/jpeg", quality)
      );
      if (!blob) throw new Error("Bildet kunne ikke komprimeres.");
      if (blob.size <= targetBytes) {
        const baseName = file.name.replace(/\.[^.]+$/, "") || "produktbilde";
        return new File([blob], `${baseName}.jpg`, { type: "image/jpeg" });
      }
      if (attempt % 4 === 3) scale *= 0.7;
    }
    throw new Error(
      "Bildet kunne ikke komprimeres til under 500 KB. Prøv et annet bilde."
    );
  } finally {
    image.close();
  }
}

export default function Home() {
  const router = useRouter();
  const [items, setItems] = useState<Item[]>([]),
    [moves, setMoves] = useState<Movement[]>([]),
    [query, setQuery] = useState(""),
    [view, setView] = useState<"items" | "history">("items"),
    [modal, setModal] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [selected, setSelected] = useState<Item | null>(null),
    [movementType, setMovementType] = useState<"in" | "out">("in"),
    [amount, setAmount] = useState("1"),
    [note, setNote] = useState(""),
    [ready, setReady] = useState(false),
    [email, setEmail] = useState(""),
    [previewImage, setPreviewImage] = useState<string | null>(null),
    [detailItem, setDetailItem] = useState<Item | null>(null);
  const api = useCallback(
    async (path: string, init: RequestInit = {}) => {
      const { data } = await browserClient().auth.getSession();
      if (!data.session) {
        router.replace("/login");
        throw Error("Ingen aktiv økt");
      }
      const res = await fetch("/api/" + path, {
        ...init,
        headers: {
          ...init.headers,
          Authorization: "Bearer " + data.session.access_token,
        },
      });
      const json = await res.json();
      if (!res.ok)
        throw Object.assign(new Error(
          (
            {
              "Yetkisiz erişim": "Ingen tilgang",
              Yetkisiz: "Ingen tilgang",
              "Silme yalnızca yöneticiye açık":
                "Kun administratorer kan slette produkter",
              "Geçersiz ad veya miktar": "Ugyldig produktnavn eller antall",
              "Geçersiz işlem": "Ugyldig lagerbevegelse",
              "Geçersiz ID": "Ugyldig produkt-ID",
              "Ürün bulunamadı veya stok yetersiz":
                "Produktet finnes ikke, eller beholdningen er for lav",
              "Resim JPEG/PNG/WebP ve en fazla 5 MB olmalı":
                "Bildet må være JPG, PNG eller WebP og maks. 5 MB",
            } as Record<string, string>
          )[json.error] ||
            json.error ||
            "Handlingen kunne ikke utføres"
        ), { code: json.code, existing_item: json.existing_item });
      return json;
    },
    [router]
  );
  const refresh = useCallback(async () => {
    try {
      const [a, b] = await Promise.all([api("items"), api("transactions")]);
      setItems(a);
      setMoves(b);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [api]);
  useEffect(() => {
    browserClient()
      .auth.getUser()
      .then(({ data }) => {
        if (!data.user) {
          router.replace("/login");
          return;
        }
        setEmail(data.user.email || "");
        setReady(true);
        refresh();
      });
  }, [router, refresh]);
  async function create(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const form = new FormData(e.currentTarget);
      const image = form.get("image");
      if (image instanceof File && image.size > 0) {
        form.set("image", await compressProductImage(image));
      }
      try {
        await api("items", { method: "POST", body: form });
      } catch (err) {
        const duplicate = err as Error & {
          code?: string;
          existing_item?: { id: string; name: string; quantity: number };
        };
        if (duplicate.code !== "DUPLICATE_PRODUCT" || !duplicate.existing_item) {
          throw err;
        }
        const existing = duplicate.existing_item;
        const extra = Number(form.get("quantity"));
        if (extra === 0) {
          setError("Produktet finnes allerede. Antallet må være større enn 0 for å oppdatere beholdningen.");
          return;
        }
        if (extra > 100000) {
          setError("Du kan legge til maksimalt 100 000 stk. om gangen.");
          return;
        }
        const approved = window.confirm(
          `Produktet «${existing.name}» finnes allerede på lageret.\n` +
          `Nåværende beholdning: ${existing.quantity} stk.\n` +
          `Legge til ${extra} stk. i den eksisterende beholdningen?`
        );
        if (!approved) return;
        await api("transactions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            item_id: existing.id,
            delta: extra,
            note: "Varemottak ved registrering av eksisterende produkt",
          }),
        });
      }
      setModal(false);
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function stock(e: React.FormEvent) {
    e.preventDefault();
    if (!selected) return;
    const quantity = Number(amount);
    if (amount.trim() === "" || !Number.isSafeInteger(quantity) || quantity <= 0) {
      setError("Antall må være et helt tall større enn 0.");
      return;
    }
    const delta = movementType === "out" ? -quantity : quantity;
    setBusy(true);
    setError("");
    try {
      await api("transactions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ item_id: selected.id, delta, note }),
      });
      setSelected(null);
      setNote("");
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function remove(item: Item) {
    if (!confirm(item.name + " slettes? Dette kan ikke angres.")) return;
    try {
      await api("items", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: item.id }),
      });
      refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function exportExcel() {
    try {
      setError("");

      const ExcelJS = (await import("exceljs")).default;
      const workbook = new ExcelJS.Workbook();

      workbook.creator = "LAGERROM";

      const sheet = workbook.addWorksheet("Lageroversikt");

      sheet.columns = [
        { header: "Bilde", key: "image", width: 16 },
        { header: "Produktnavn", key: "name", width: 30 },
        { header: "Produktkode", key: "sku", width: 18 },
        { header: "Kategori", key: "category", width: 22 },
        { header: "Plassering", key: "location", width: 22 },
        { header: "Beholdning", key: "quantity", width: 16 },
        { header: "Beskrivelse", key: "description", width: 50 },
        { header: "Lagt til av", key: "created_by_email", width: 32 },
        { header: "Registrert dato", key: "created_at", width: 24 },
      ];

      const products: Item[] = await api("items");

      for (const item of products) {
        const row = sheet.addRow({
          name: item.name,
          sku: item.sku || "",
          category: item.category || "",
          location: item.location || "",
          quantity: item.quantity,
          description: item.description || "",
          created_by_email: item.created_by_email || "Ukjent bruker",
          created_at: item.created_at
            ? new Date(item.created_at).toLocaleString("nb-NO")
            : "",
        });

        row.height = 65;
        row.alignment = {
          vertical: "middle",
          wrapText: true,
        };

        if (item.image_url) {
          try {
            const response = await fetch(item.image_url);

            if (!response.ok) {
              throw new Error("Kunne ikke hente bildet");
            }

            const blob = await response.blob();

            // Fotoğrafı JPEG'e dönüştür.
            // Böylece WebP dosyaları da Excel'de görünür.
            const bitmap = await createImageBitmap(blob);

            const canvas = document.createElement("canvas");
            canvas.width = 100;
            canvas.height = 100;

            const ctx = canvas.getContext("2d");

            if (!ctx) {
              throw new Error("Kunne ikke behandle bildet");
            }

            ctx.fillStyle = "#ffffff";
            ctx.fillRect(0, 0, 100, 100);

            const scale = Math.min(100 / bitmap.width, 100 / bitmap.height);

            const width = bitmap.width * scale;
            const height = bitmap.height * scale;

            ctx.drawImage(
              bitmap,
              (100 - width) / 2,
              (100 - height) / 2,
              width,
              height
            );

            bitmap.close();

            const dataUrl = canvas.toDataURL("image/jpeg", 0.8);

            const imageId = workbook.addImage({
              base64: dataUrl,
              extension: "jpeg",
            });

            sheet.addImage(imageId, {
              tl: {
                col: 0.15,
                row: row.number - 1 + 0.08,
              },
              ext: {
                width: 80,
                height: 80,
              },
              editAs: "oneCell",
            });
          } catch (imageError) {
            console.error(
              "Kunne ikke eksportere bildet:",
              item.name,
              imageError
            );

            row.getCell(1).value = "Bilde utilgjengelig";
          }
        }
      }

      // Başlık tasarımı
      const header = sheet.getRow(1);

      header.height = 28;

      header.font = {
        bold: true,
        color: { argb: "FFFFFFFF" },
      };

      header.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FF17324D" },
      };

      header.alignment = {
        vertical: "middle",
      };

      // Filtre
      sheet.autoFilter = {
        from: "A1",
        to: "I1",
      };

      sheet.views = [
        {
          state: "frozen",
          ySplit: 1,
        },
      ];

      // Excel dosyasını oluştur
      const buffer = await workbook.xlsx.writeBuffer();

      const excelBlob = new Blob([buffer as BlobPart], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });

      const url = URL.createObjectURL(excelBlob);
      const link = document.createElement("a");

      link.href = url;
      link.download = `LAGERROM_${new Date().toISOString().slice(0, 10)}.xlsx`;

      document.body.appendChild(link);
      link.click();
      link.remove();

      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Kunne ikke eksportere til Excel"
      );
    }
  }
  const filtered = items.filter((i) =>
    [i.name, i.sku, i.category, i.location].some((v) =>
      (v || "").toLowerCase().includes(query.toLowerCase())
    )
  );
  if (!ready) return <main className="loading">Laster lageroversikten…</main>;
  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
        <div className="brand-icon">
  <img
    src="/favicon.ico"
    alt="Forandringshuset"
    className="brand-logo"
  />
</div>
          <span>
            LAGERROM<small>LAGERSTYRING</small>
          </span>
        </div>
        <div className="side-label">ARBEIDSOMRÅDE</div>
        <button
          className={"nav " + (view === "items" ? "active" : "")}
          onClick={() => setView("items")}
        >
          <Boxes size={19} /> Lageroversikt
        </button>
        <button
  type="button"
  onClick={() => router.push("/kamera")}
  className="ai-nav-button"
>
  <Camera size={18} />
  <span>AI-varetelling</span>
</button>
        <button
          className={"nav " + (view === "history" ? "active" : "")}
          onClick={() => setView("history")}
        >
          <History size={19} /> Bevegelseshistorikk
        </button>
        <div className="side-bottom">
          <div className="avatar">{email.charAt(0).toUpperCase()}</div>
          <div className="account">
          <div className="app-version">
  <span>Systemversjon</span>
  <strong>v1.0.0</strong>
</div>
            <strong>Autorisert bruker</strong>
            <small>{email}</small>
          </div>
          <button
            title="Logg ut"
            className="icon-button"
            onClick={async () => {
              await browserClient().auth.signOut();
              router.replace("/login");
            }}
          >
            <LogOut size={18} />
          </button>
        </div>
      </aside>
      <main className="main">
        <header className="top">
          <span>
            Arbeidsområde{" "}
            <b>
              / {view === "items" ? "Lageroversikt" : "Bevegelseshistorikk"}
            </b>
          </span>
          <span className="status">
            <i /> Systemet er aktivt
          </span>
        </header>
        <div className="content">
        <div className="page-heading">
  <div>
    <p className="eyebrow">LAGERADMINISTRASJON</p>
    <h1>
      {view === 'items' ? 'Lageroversikt' : 'Bevegelseshistorikk'}
    </h1>
    <p className="muted">
      {view === 'items'
        ? 'Alle varene dine samlet på ett sted, med oppdatert beholdning.'
        : 'Se de 100 siste lagerbevegelsene.'}
    </p>
  </div>

  {view === 'items' && (
    <div className="page-actions">
      <button
        type="button"
        className="excel-button"
        onClick={exportExcel}
      >
        <FileSpreadsheet size={19} />
        Eksporter til Excel
      </button>

      <button
        type="button"
        className="primary add"
        onClick={() => {
          setError('');
          setModal(true);
        }}
      >
        <Plus size={18} />
        Legg til nytt produkt
      </button>
    </div>
  )}
</div>
          {error && (
            <div className="error banner">
              {error} <button onClick={() => setError("")}>×</button>
            </div>
          )}
          {view === "items" ? (
            <>
              <div className="stats">
                <div className="stat">
                  <div className="stat-icon">
                    <Package size={21} />
                  </div>
                  <p>Antall produkttyper</p>
                  <strong>{items.length}</strong>
                  <small>Registrert på lageret</small>
                </div>
                <div className="stat">
                  <div className="stat-icon">
                    <Boxes size={21} />
                  </div>
                  <p>Totalt antall på lager</p>
                  <strong>{items.reduce((s, i) => s + i.quantity, 0)}</strong>
                  <small>Samlet beholdning</small>
                </div>
                <div className="stat">
                  <div className="stat-icon warn">
                    <ArrowDownRight size={21} />
                  </div>
                  <p>Lav lagerbeholdning</p>
                  <strong>{items.filter((i) => i.quantity <= 5).length}</strong>
                  <small>5 stk. eller færre</small>
                </div>
              </div>
              <section className="panel">
                <div className="panel-top">
                  <div>
                    <h2>Produktliste</h2>
                    <p className="muted small">
                      {filtered.length} produkter vises
                    </p>
                  </div>
                  <div className="search">
                    <Search size={17} />
                    <input
                      placeholder="Søk etter produkt"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                    />
                  </div>
                </div>
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>PRODUKT</th>
                        <th>KATEGORI</th>
                        <th>PLASSERING</th>
                        <th>BEHOLDNING</th>
                        <th>HANDLINGER</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.map((i) => (
                        <tr key={i.id}>
                          <td>
                            <div className="product">
                              <div className="thumb">
                                {i.image_url ? (
                                  <button
                                    type="button"
                                    className="thumb-preview"
                                    onClick={() =>
                                      setPreviewImage(i.image_url!)
                                    }
                                    title="Klikk for å forstørre bildet"
                                    aria-label={`Forstørr bilde av ${i.name}`}
                                  >
                                    <img src={i.image_url} alt={i.name} />
                                  </button>
                                ) : (
                                  <Package size={23} />
                                )}
                              </div>
                              <div>
                                <button
                                  type="button"
                                  className="product-name-button"
                                  onClick={() => setDetailItem(i)}
                                  title="Vis produktdetaljer"
                                >
                                  {i.name}
                                </button>
                                <small>
                                  {i.sku ||
                                    i.description ||
                                    "Registrert produkt"}
                                </small>
                              </div>
                            </div>
                          </td>
                          <td>{i.category || "—"}</td>
                          <td>
                            <span className="location">
                              <MapPin size={14} />
                              {i.location || "—"}
                            </span>
                          </td>
                          <td>
                            <span
                              className={
                                "pill " + (i.quantity <= 5 ? "low" : "")
                              }
                            >
                              {i.quantity} stk.
                            </span>
                          </td>
                          <td>
                            <div className="actions">
                              <button
                                title="Registrer varemottak"
                                onClick={() => {
                                  setSelected(i);
                                  setMovementType("in");
                                  setAmount("1");
                                  setError("");
                                }}
                              >
                                <ArrowUpRight size={17} />
                              </button>
                              <button
                                title="Registrer vareuttak"
                                onClick={() => {
                                  setSelected(i);
                                  setMovementType("out");
                                  setAmount("1");
                                  setError("");
                                }}
                              >
                                <ArrowDownRight size={17} />
                              </button>
                              <button
                                title="Slett (administrator)"
                                onClick={() => remove(i)}
                              >
                                <Trash2 size={16} />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {!filtered.length && (
                    <div className="empty">
                      Ingen produkter funnet. Legg til et nytt produkt for å
                      komme i gang.
                    </div>
                  )}
                </div>
              </section>
            </>
          ) : (
            <section className="panel">
              <div className="panel-top">
                <h2>Siste lagerbevegelser</h2>
              </div>
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>DATO</th>
                      <th>PRODUKT</th>
                      <th>ENDRING</th>
                      <th>MERKNAD</th>
                    </tr>
                  </thead>
                  <tbody>
                    {moves.map((m) => (
                      <tr key={m.id}>
                        <td>
                          {new Date(m.created_at).toLocaleString("nb-NO")}
                        </td>
                        <td>
                          <strong>{m.items?.name || "Slettet produkt"}</strong>
                        </td>
                        <td>
                          <span
                            className={"pill " + (m.delta < 0 ? "low" : "")}
                          >
                            {m.delta > 0 ? "+" : ""}
                            {m.delta}
                          </span>
                        </td>
                        <td>{m.note || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!moves.length && (
                  <div className="empty">
                    Ingen lagerbevegelser er registrert ennå.
                  </div>
                )}
              </div>
            </section>
          )}
        </div>
      </main>
      {modal && (
        <div
          className="overlay"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setModal(false);
          }}
        >
          <div className="dialog">
            <div className="dialog-top">
              <div>
                <p className="eyebrow">NY REGISTRERING</p>
                <h2>Legg til produkt</h2>
              </div>
              <button onClick={() => setModal(false)} className="close">
                ×
              </button>
            </div>
            {error && <div className="error banner">{error}</div>}
            <form onSubmit={create} className="form">
              <label>
                Produktnavn *
                <input
                  name="name"
                  maxLength={180}
                  required
                  placeholder="F.eks. Bosch drill"
                />
              </label>
              <div className="form-row">
                <label>
                  Produktkode
                  <input name="sku" placeholder="STK-001" />
                </label>
                <label>
                  Startbeholdning
                  <input
                    name="quantity"
                    type="number"
                    min="0"
                    step="1"
                    defaultValue="1"
                    required
                  />
                </label>
              </div>
              <div className="form-row">
                <label>
                  Kategori
                  <input name="category" placeholder="Elektronikk" />
                </label>
                <label>
                  Lagerplassering
                  <input name="location" placeholder="Hylle A-03" />
                </label>
              </div>
              <label>
                Beskrivelse / egenskaper
                <textarea
                  name="description"
                  rows={3}
                  placeholder="Merke, modell, tekniske spesifikasjoner..."
                />
              </label>
              <label className="file-label">
                <ImagePlus size={20} /> Legg til bilde (JPG, PNG, WebP –
                komprimeres automatisk til maks. 500 KB)
                <input
                  name="image"
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                />
              </label>
              <div className="form-actions">
                <button
                  type="button"
                  className="secondary"
                  onClick={() => setModal(false)}
                >
                  Avbryt
                </button>
                <button className="primary" disabled={busy}>
                  {busy ? "Lagrer…" : "Lagre produkt"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      {selected && (
        <div
          className="overlay"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setSelected(null);
          }}
        >
          <div className="dialog compact">
            <div className="dialog-top">
              <div>
                <p className="eyebrow">LAGERBEVEGELSE</p>
                <h2>{selected.name}</h2>
                <p className="muted">
                  Nåværende beholdning: {selected.quantity} stk.
                </p>
              </div>
              <button className="close" onClick={() => setSelected(null)}>
                ×
              </button>
            </div>
            {error && <div className="error banner">{error}</div>}
            <form className="form" onSubmit={stock}>
              <label>
                Type lagerbevegelse
                <select
                  value={movementType}
                  onChange={(e) => setMovementType(e.target.value as "in" | "out")}
                >
                  <option value="in">Registrer varemottak (+)</option>
                  <option value="out">Registrer vareuttak (−)</option>
                </select>
              </label>
              <label>
                Antall
                <input
                  type="number"
                  min="1"
                  step="1"
                  required
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                />
              </label>
              <label>
                Merknad (valgfritt)
                <input
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Hvem tok varen / hva ble den brukt til?"
                />
              </label>
              <div className="form-actions">
                <button
                  type="button"
                  className="secondary"
                  onClick={() => setSelected(null)}
                >
                  Avbryt
                </button>
                <button className="primary" disabled={busy || amount.trim() === "" || !Number.isSafeInteger(Number(amount)) || Number(amount) <= 0}>
                  {busy ? "Lagrer…" : "Oppdater beholdning"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      {detailItem && (
        <div
          className="overlay"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setDetailItem(null);
          }}
        >
          <div
            className="dialog product-detail-dialog"
            role="dialog"
            aria-modal="true"
            aria-label="Produktdetaljer"
          >
            <div className="dialog-top">
              <div>
                <p className="eyebrow">PRODUKTDETALJER</p>
                <h2>{detailItem.name}</h2>
              </div>
              <button
                type="button"
                className="close"
                onClick={() => setDetailItem(null)}
                aria-label="Lukk produktdetaljer"
              >
                ×
              </button>
            </div>
            {detailItem.image_url && (
              <button
                type="button"
                className="product-detail-photo"
                onClick={() => setPreviewImage(detailItem.image_url!)}
                title="Klikk for å forstørre bildet"
              >
                <img src={detailItem.image_url} alt={detailItem.name} />
              </button>
            )}
            <dl className="product-detail-grid">
              <div>
                <dt>Produktnavn</dt>
                <dd>{detailItem.name}</dd>
              </div>
              <div>
                <dt>Produktkode</dt>
                <dd>{detailItem.sku || "Ikke registrert"}</dd>
              </div>
              <div>
                <dt>Kategori</dt>
                <dd>{detailItem.category || "Ikke registrert"}</dd>
              </div>
              <div>
                <dt>Plassering</dt>
                <dd>{detailItem.location || "Ikke registrert"}</dd>
              </div>
              <div>
                <dt>Beholdning</dt>
                <dd>{detailItem.quantity} stk.</dd>
              </div>
              <div>
                <dt>Lagt til av</dt>
                <dd>{detailItem.created_by_email || "Ukjent bruker"}</dd>
              </div>

              <div>
                <dt>Registrert dato</dt>
                <dd>
                  {detailItem.created_at
                    ? new Date(detailItem.created_at).toLocaleString("nb-NO", {
                        day: "2-digit",
                        month: "2-digit",
                        year: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })
                    : "Ikke registrert"}
                </dd>
              </div>
            </dl>
            <div className="product-detail-description">
              <h3>Beskrivelse og spesifikasjoner</h3>
              <p>{detailItem.description || "Ingen beskrivelse registrert."}</p>
            </div>
            <div className="form-actions">
              <button
                type="button"
                className="secondary"
                onClick={() => setDetailItem(null)}
              >
                Lukk
              </button>
            </div>
          </div>
        </div>
      )}
      {previewImage && (
        <div
          className="image-preview-overlay"
          role="presentation"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setPreviewImage(null);
          }}
        >
          <div
            className="image-preview-content"
            role="dialog"
            aria-modal="true"
            aria-label="Forstørret produktbilde"
          >
            <button
              type="button"
              className="image-preview-close"
              onClick={() => setPreviewImage(null)}
              aria-label="Lukk bildet"
            >
              ×
            </button>
            <img src={previewImage} alt="Forstørret produktbilde" />
          </div>
        </div>
      )}
    </div>
  );
}
