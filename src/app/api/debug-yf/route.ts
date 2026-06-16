// src/app/api/debug-yf/route.ts
// Yahoo Finance v10で日本株の有利子負債が取れるか確認用
import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const code = searchParams.get("code") ?? "1333";
  const symbol = `${code}.T`;

  // まずcrumbを取得
  let crumb = "";
  let cookies = "";
  try {
    const crumbRes = await fetch("https://query2.finance.yahoo.com/v1/test/getcrumb", {
      headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36" },
    });
    crumb = await crumbRes.text();
    cookies = crumbRes.headers.get("set-cookie") ?? "";
  } catch (e) {
    return NextResponse.json({ error: "crumb取得失敗", detail: String(e) });
  }

  // balanceSheetHistory で有利子負債を取得
  try {
    const url = `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${symbol}?modules=balanceSheetHistory&crumb=${encodeURIComponent(crumb)}`;
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
        "Accept": "application/json",
        "Cookie": cookies,
      },
    });

    const data = await res.json();
    const result = data?.quoteSummary?.result?.[0];
    const statements = result?.balanceSheetHistory?.balanceSheetStatements ?? [];

    if (statements.length === 0) {
      return NextResponse.json({ symbol, crumb, error: "財務データなし", raw: data });
    }

    // 有利子負債に関連するフィールドを抽出
    const ibdFields = [
      "shortTermDebt", "currentPortionOfLongTermDebt",
      "longTermDebt", "longTermDebtNoncurrent",
      "shortLongTermDebt", "shortLongTermDebtTotal",
    ];

    const extracted = statements.map((s: Record<string, {raw?: number}>) => {
      const result: Record<string, number | string> = {
        endDate: String(s.endDate ?? ""),
      };
      for (const f of ibdFields) {
        if (s[f]?.raw !== undefined) result[f] = s[f].raw!;
      }
      return result;
    });

    return NextResponse.json({ symbol, statements: extracted });
  } catch (e) {
    return NextResponse.json({ error: String(e) });
  }
}
