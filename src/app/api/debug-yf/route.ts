// src/app/api/debug-yf/route.ts
import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const code = searchParams.get("code") ?? "1333";
  const symbol = `${code}.T`;

  const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

  // Step1: Yahoo Financeのトップページにアクセスしてcookieを取得
  let cookieHeader = "";
  try {
    const homeRes = await fetch(`https://finance.yahoo.com/quote/${symbol}/financials/`, {
      headers: { "User-Agent": UA, "Accept-Language": "en-US,en;q=0.9" },
      redirect: "follow",
    });
    const setCookie = homeRes.headers.get("set-cookie") ?? "";
    // 必要なcookieを抽出
    const cookies = setCookie.split(",").map(c => c.split(";")[0].trim()).filter(Boolean);
    cookieHeader = cookies.join("; ");
  } catch (e) {
    return NextResponse.json({ step: "cookie取得失敗", error: String(e) });
  }

  // Step2: crumb取得
  let crumb = "";
  try {
    const crumbRes = await fetch("https://query1.finance.yahoo.com/v1/test/getcrumb", {
      headers: {
        "User-Agent": UA,
        "Cookie": cookieHeader,
        "Accept": "*/*",
      },
    });
    crumb = await crumbRes.text();
    const newCookies = crumbRes.headers.get("set-cookie");
    if (newCookies) {
      const extra = newCookies.split(",").map(c => c.split(";")[0].trim()).filter(Boolean);
      cookieHeader = [...cookieHeader.split("; "), ...extra].filter(Boolean).join("; ");
    }
  } catch (e) {
    return NextResponse.json({ step: "crumb取得失敗", error: String(e) });
  }

  if (!crumb || crumb.includes("{")) {
    return NextResponse.json({ step: "crumb無効", crumb, cookie: cookieHeader.slice(0, 100) });
  }

  // Step3: balanceSheetHistory取得
  try {
    const url = `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${symbol}?modules=balanceSheetHistory&crumb=${encodeURIComponent(crumb)}`;
    const res = await fetch(url, {
      headers: {
        "User-Agent": UA,
        "Cookie": cookieHeader,
        "Accept": "application/json",
      },
    });

    const data = await res.json();
    const statements = data?.quoteSummary?.result?.[0]?.balanceSheetHistory?.balanceSheetStatements ?? [];

    if (statements.length === 0) {
      return NextResponse.json({ symbol, crumb, status: res.status, error: "財務データなし", raw: data });
    }

    const ibdFields = [
      "shortTermDebt", "currentPortionOfLongTermDebt",
      "longTermDebt", "longTermDebtNoncurrent",
      "shortLongTermDebt", "shortLongTermDebtTotal",
      "totalDebt",
    ];

    const extracted = statements.map((s: Record<string, {raw?: number} | string>) => {
      const row: Record<string, number | string> = { endDate: String((s.endDate as {fmt?: string})?.fmt ?? "") };
      for (const f of ibdFields) {
        const v = s[f] as {raw?: number} | undefined;
        if (v?.raw !== undefined) row[f] = v.raw;
      }
      return row;
    });

    return NextResponse.json({ symbol, success: true, statements: extracted });
  } catch (e) {
    return NextResponse.json({ step: "BS取得失敗", error: String(e) });
  }
}
