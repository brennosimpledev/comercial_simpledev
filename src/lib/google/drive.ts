// Google Drive - localiza transcricoes e gravacoes geradas pelo Meet.
// SERVER-ONLY.
//
// O Meet salva a transcricao como Google Doc e a gravacao como video na
// pasta "Meet Recordings" do organizador. O nome do arquivo deriva do titulo
// do evento, e como padronizamos o titulo em "Nome — SimpleDEV", da para
// achar buscando pelo nome do lead.

export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  webViewLink: string;
  modifiedTime: string;
  tipo: "transcricao" | "gravacao" | "outro";
}

// A query do Drive delimita strings com aspas simples, entao um apostrofo no
// nome do lead quebraria a expressao.
function escapeQ(s: string) {
  return s.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

function classify(mimeType: string): DriveFile["tipo"] {
  if (mimeType === "application/vnd.google-apps.document") return "transcricao";
  if (mimeType.startsWith("video/")) return "gravacao";
  return "outro";
}

// Busca arquivos do Meet relacionados a uma reuniao.
// A janela vai de um dia antes ate sete depois: a transcricao aparece logo
// apos a call, mas o processamento as vezes atrasa.
export async function findMeetFiles(
  accessToken: string,
  opts: { leadNome: string; startsAt: string }
): Promise<{ ok: boolean; files?: DriveFile[]; error?: string }> {
  const nome = (opts.leadNome ?? "").trim();
  if (!nome) return { ok: false, error: "Lead sem nome." };

  const start = new Date(opts.startsAt);
  if (isNaN(start.getTime())) return { ok: false, error: "Data inválida." };

  const de = new Date(start.getTime() - 24 * 3600_000).toISOString();
  const ate = new Date(start.getTime() + 7 * 24 * 3600_000).toISOString();

  // Sem filtro de mimeType na query: o operador contains do Drive nao faz
  // substring nesse campo e engolia as gravacoes em video. Filtrar por nome
  // e janela de tempo ja e restritivo o bastante; o tipo a gente classifica
  // no cliente. So pastas ficam de fora, com != que e bem suportado.
  const q = [
    `name contains '${escapeQ(nome)}'`,
    `modifiedTime >= '${de}'`,
    `modifiedTime <= '${ate}'`,
    "trashed = false",
    "mimeType != 'application/vnd.google-apps.folder'",
  ].join(" and ");

  const params = new URLSearchParams({
    q,
    fields: "files(id,name,mimeType,webViewLink,modifiedTime)",
    orderBy: "modifiedTime desc",
    pageSize: "20",
    // Inclui unidades compartilhadas: em Workspace a gravacao costuma cair la.
    supportsAllDrives: "true",
    includeItemsFromAllDrives: "true",
  });

  try {
    const res = await fetch(
      `https://www.googleapis.com/drive/v3/files?${params.toString()}`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    const data = await res.json();

    if (!res.ok) {
      const msg = data?.error?.message ?? JSON.stringify(data);
      return { ok: false, error: String(msg).slice(0, 400) };
    }

    const files: DriveFile[] = (data.files ?? []).map(
      (f: {
        id: string;
        name: string;
        mimeType: string;
        webViewLink: string;
        modifiedTime: string;
      }) => ({
        id: f.id,
        name: f.name,
        mimeType: f.mimeType,
        webViewLink: f.webViewLink,
        modifiedTime: f.modifiedTime,
        tipo: classify(f.mimeType),
      })
    );

    // Transcricao primeiro: e o que o SDR quer na maioria das vezes.
    files.sort((a, b) =>
      a.tipo === b.tipo ? 0 : a.tipo === "transcricao" ? -1 : 1
    );

    return { ok: true, files };
  } catch (e) {
    return { ok: false, error: String(e).slice(0, 400) };
  }
}
