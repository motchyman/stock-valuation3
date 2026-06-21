// src/app/api/repair-names/route.ts
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const JQ_BASE = "https://api.jquants.com/v2";
const JQ_KEY  = process.env.JQUANTS_API_KEY ?? "";
const JQ_H    = { "x-api-key": JQ_KEY };
const SB_URL  = process.env.SUPABASE_URL ?? "";
const SB_KEY  = process.env.SUPABASE_ANON_KEY ?? "";

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

// 直近の営業日を返す（土日を除く）
function getRecentBusinessDay(daysAgo: number): string {
  const d = new Date();
  let count = 0;
  while (count < daysAgo) {
    d.setDate(d.getDate() - 1);
    if (d.getDay() !== 0 && d.getDay() !== 6) count++;
  }
  return d.toISOString().slice(0, 10).replace(/-/g, "");
}

// J-Quantsから全銘柄マスタ（code-name-sector）を取得
async function fetchJQuantsMaster(): Promise<Map<string, { name: string; sector: string }>> {
  const masterMap = new Map<string, { name: string; sector: string }>();

  // 直近30日のいずれかの営業日でデータが取れるまで試す
  for (let daysAgo = 1; daysAgo <= 30; daysAgo++) {
    const date = getRecentBusinessDay(daysAgo);
    const url = `${JQ_BASE}/equities/master?date=${date}`;
    const res = await fetch(url, { headers: JQ_H });

    if (res.status === 429) {
      await sleep(60000);
      continue;
    }
    if (!res.ok) continue;

    const json = await res.json();
    const list: Record<string, unknown>[] = json?.data ?? json?.info ?? [];

    for (const item of list) {
      const code = String(item.Code ?? "").slice(0, 4);
      const name = String(item.CompanyName ?? "");
      const sector = String(item.Sector33CodeName ?? "");
      if (code && name) {
        masterMap.set(code, { name, sector });
      }
    }

    if (masterMap.size > 0) {
      console.log(`銘柄マスタ取得完了: date=${date}, ${masterMap.size}銘柄`);
      break;
    }
    await sleep(1000);
  }

  return masterMap;
}

async function getSupabaseStocksWithoutName(): Promise<string[]> {
  const url = `${SB_URL}/rest/v1/stocks?select=code&or=(name.is.null,name.eq.)&order=code.asc&limit=5000`;
  const res = await fetch(url, {
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` },
  });
  if (!res.ok) return [];
  const data = await res.json();
  return data.map((d: { code: string }) => d.code);
}

async function patchName(code: string, name: string, sector: string): Promise<boolean> {
  const res = await fetch(`${SB_URL}/rest/v1/stocks?code=eq.${code}`, {
    method: "PATCH",
    headers: {
      apikey: SB_KEY,
      Authorization: `Bearer ${SB_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify({ name, sector }),
  });
  return res.ok;
}

export async function GET(req: NextRequest) {
  if (!JQ_KEY) return NextResponse.json({ error: "JQUANTS_API_KEY not set" }, { status: 500 });
  if (!SB_URL) return NextResponse.json({ error: "SUPABASE_URL not set" }, { status: 500 });

  const { searchParams } = new URL(req.url);
  const dryRun = searchParams.get("dryRun") === "1";

  // ① J-Quantsから銘柄マスタを取得
  const jqMaster = await fetchJQuantsMaster();
  if (jqMaster.size === 0) {
    return NextResponse.json({ error: "J-Quants銘柄マスタの取得に失敗しました" }, { status: 500 });
  }

  // ② Supabaseでnameが空の銘柄を取得
  const missingCodes = await getSupabaseStocksWithoutName();

  if (dryRun) {
    // 実際の更新は行わず、何件マッチするかだけ確認
    let matchCount = 0;
    const sample: { code: string; name: string }[] = [];
    for (const code of missingCodes) {
      const m = jqMaster.get(code);
      if (m) {
        matchCount++;
        if (sample.length < 10) sample.push({ code, name: m.name });
      }
    }
    return NextResponse.json({
      jqMasterSize: jqMaster.size,
      missingInSupabase: missingCodes.length,
      matchCount,
      sample,
      message: "dryRun完了。実際の更新は行っていません。",
    });
  }

  // ③ 実際に復旧
  let updated = 0;
  let notFound = 0;
  const notFoundCodes: string[] = [];

  for (const code of missingCodes) {
    const m = jqMaster.get(code);
    if (!m) {
      notFound++;
      notFoundCodes.push(code);
      continue;
    }
    const ok = await patchName(code, m.name, m.sector);
    if (ok) updated++;
    await sleep(50);
  }

  return NextResponse.json({
    jqMasterSize: jqMaster.size,
    missingInSupabase: missingCodes.length,
    updated,
    notFound,
    notFoundCodes: notFoundCodes.slice(0, 30),
    message: `復旧完了: ${updated}件更新、${notFound}件はJ-Quantsにも見つからず`,
  });
}
