import type { ReactNode } from 'react';
import type { Locale, Release } from '../../../packages/domain/src/contracts';
import { DEFAULT_BASKET_SOURCE } from '../../../packages/domain/src/defaultBasket';

const messages = {
  en: {
    title: 'Data source',
    close: 'Close data source',
    independent: 'Independent project using official statistics. Not a government website.',
    sourceTitle: 'Official monthly city prices',
    source:
      'Prices come from the Statistics Bureau of Japan’s Retail Price Survey (Trend Survey), including its earlier series. Its monthly city tables and dated product specifications provide a consistent foundation for long-term comparisons. Public downloads from e-Stat and the Statistics Bureau supply the price history; other sources do not fill missing prices.',
    survey: 'About the Retail Price Survey',
    prices: 'Official city price tables',
    freshnessTitle: 'Data freshness',
    latest: 'Latest price month included',
    downloaded: 'Source files downloaded',
    japanTime: 'Japan time',
    datesUnavailable: 'Download dates are unavailable in this snapshot.',
    freshness:
      'This website uses a reviewed snapshot, refreshed by manual import and rebuild. “Now” selects the latest month included here, not the current calendar month. Download dates record source acquisition, not publication dates or a check for newer reports.',
    calculationTitle: 'How basket prices are compared',
    calculation:
      'The same products and quantities are priced each month using published, tax-inclusive survey averages. Dated units and known pack sizes are converted to your chosen quantity; fractional packs represent an equivalent cost. These are survey prices, not today’s quote from a named shop.',
    definitions:
      'Reviewed minor changes in brand, grade or size can continue a generic food history. Original Japanese definitions remain in product details. Brand searches match dated definitions, rather than a dedicated brand price series. Unresolved changes stay separate. Quantity conversion does not remove quality differences or pack-size pricing effects.',
    missingTitle: 'Missing and seasonal prices',
    missing:
      'Reviewed short missing-price gaps may use the last actual observation for up to two months. For reviewed seasonal goods, it can carry through months outside the survey calendar for up to 11 months. Every estimate keeps its observation month and age. Estimates do not chain, reach before the first observation or replace prices with another city’s values.',
    estimateMeaning:
      'Dashed lines and estimated labels identify carried prices or estimated quantity conversions. Seasonal carry-forward smooths gaps; it is not seasonal adjustment. Longer unresolved gaps remain unavailable. “Observed prices only” disables price carry-forward; disclosed quantity estimates still apply.',
    starterTitle: 'Why these starter quantities?',
    starter:
      'The 16-food starter includes rice, bread, meat, fish, eggs, milk, vegetables and cooking essentials. Fixed, roughly monthly quantities are informed by 2025 nationwide purchases of households with two or more people, divided by 12 and rounded. Surveyed varieties stand in for broader categories; the basket is editable and is not a complete food budget.',
    assumptions:
      'Eggs use an approximate 60 g per whole egg where a weight-to-count conversion is needed. Tofu uses a chosen 2 kg because the purchase report counts blocks without weights. These assumptions remain disclosed rather than being treated as exact measurements.',
    purchases: '2025 household purchases · quantity table 6-2',
    coverageTitle: 'Coverage and interpretation',
    coverage:
      'All current survey cities are listed, with historical areas kept separate. History starts in January 2000 where reviewed data exists; individual foods and cities may start later or have interruptions. Search offers products usable throughout your chosen city, dates and estimate mode. Unavailable items are never silently dropped from a basket total.',
    selectedCity: 'Selected city’s surveyed period',
    interpretation:
      'Results show nominal yen changes for your fixed basket, not Japan’s official inflation rate. The index sets your baseline cost to 100. Local specifications and sampled shops can differ, so this tool does not rank cities by cost of living.',
    cpi: 'How the official Consumer Price Index differs',
    technical: 'Snapshot details',
    release: 'Dataset',
    policy: 'Data policy',
  },
  ja: {
    title: '出典',
    close: '出典を閉じる',
    independent: '公式統計を利用した個人プロジェクトです。政府のウェブサイトではありません。',
    sourceTitle: '公式の月次・都市別価格',
    source:
      '価格には総務省統計局の小売物価統計調査（動向編）と、その前身の調査を使用しています。月次の都市別価格表と時期ごとの銘柄定義を確認できるため、長期比較の基盤として選びました。価格の推移はe-Stat・統計局の公開ファイルから収録し、欠測を他の価格資料で補ってはいません。',
    survey: '小売物価統計調査について',
    prices: '公式の都市別価格表',
    freshnessTitle: 'データの更新状況',
    latest: '収録した価格の最新月',
    downloaded: '元ファイルの取得日',
    japanTime: '日本時間',
    datesUnavailable: 'このデータには元ファイルの取得日がありません。',
    freshness:
      '確認済みのデータを収録し、手動で取り込み・再構築して更新しています。「最新」は現在の暦月ではなく、ここに収録した最新月です。取得日は公表日や新しい報告の有無を確認した日とは異なります。',
    calculationTitle: 'かごの価格を比較する方法',
    calculation:
      '毎月同じ商品・数量を、税込みの公表平均価格で計算します。各時期の単位や確認済みの包装容量を選択数量に換算し、包装の端数は相当額として扱います。特定の店舗の今日の販売価格ではありません。',
    definitions:
      '確認済みの軽微なブランド・等級・サイズ変更は、同じ種類の食品としてつなぎます。元の日本語の定義は商品の詳細に残します。ブランド名の検索は時期ごとの定義に基づき、ブランド専用の価格系列を示すものではありません。解決していない変更は分けて扱います。数量を換算しても、品質の違いや包装サイズによる単価差の影響は残ります。',
    missingTitle: '欠測・季節商品の扱い',
    missing:
      '確認済みの短い欠測は、直前の実測値を最長2か月引き継ぎます。確認済みの季節商品は、調査暦の対象外の月に最長11か月引き継げます。推定値には元の実測月と経過月数を残します。推定値からの連鎖、最初の実測より前への補完、他都市の価格による代用は行いません。',
    estimateMeaning:
      '破線と「推定」の表示は、価格の引き継ぎや推定による数量換算を示します。季節的な欠測をならす扱いであり、季節調整ではありません。解決しない長期欠測は利用不可のままです。「実測値のみを使う」は価格の引き継ぎを止めますが、明示した数量の推定換算は適用します。',
    starterTitle: '基本のかごの数量を選んだ理由',
    starter:
      '基本の16品目は、米・パン・肉・魚・卵・牛乳・野菜・調理用の食材を含みます。2025年の全国・二人以上の世帯の年間購入量を12で割り、丸めた、おおむね1か月分の固定数量です。広い食品区分を特定の調査銘柄で代表させた編集可能な例であり、食費全体を表しません。',
    assumptions:
      '重量から個数への換算が必要な卵は、殻を含む1個約60gとして扱います。豆腐は購入統計が重さのない丁数のため、例として2kgを選びました。これらの仮定を正確な実測量として扱わず、明示しています。',
    purchases: '2025年の世帯購入量・第6-2表',
    coverageTitle: '収録範囲と結果の意味',
    coverage:
      '現在の全調査都市を選択でき、過去の調査区域は別に扱います。確認できた価格は2000年1月から収録していますが、食品・都市によって開始月が遅かったり中断があったりします。検索には選択した都市・全期間・推定設定で利用できる商品を表示します。利用できない商品を黙って合計から除くことはありません。',
    selectedCity: '選択した都市の調査期間',
    interpretation:
      '結果は固定したかごの名目円価格の変化であり、日本の公式な物価上昇率ではありません。指数は選択した基準月の費用を100とします。都市ごとの銘柄・調査店舗は異なるため、都市間の生活費ランキングには使えません。',
    cpi: '公式の消費者物価指数との違い',
    technical: '収録データの詳細',
    release: 'データセット',
    policy: 'データ方針',
  },
};

/** Retrieval time is deliberately separate from price month and publication time. */
export function sourceDownloadWindow(release: Release) {
  const dates = release.sources
    .map((source) => Date.parse(source.retrievedAt))
    .filter(Number.isFinite);
  if (!dates.length) return null;
  return { first: Math.min(...dates), last: Math.max(...dates) };
}

export function DataSource({
  release,
  locale,
  cityId,
  children,
}: {
  release: Release;
  locale: Locale;
  cityId: string;
  children?: ReactNode;
}) {
  const t = messages[locale];
  const city = release.cities.find((entry) => entry.id === cityId)!;
  const window = sourceDownloadWindow(release);
  const date = (value: number) =>
    new Intl.DateTimeFormat(locale === 'en' ? 'en-GB' : 'ja-JP', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      timeZone: 'Asia/Tokyo',
    }).format(value);
  const month = new Intl.DateTimeFormat(locale === 'en' ? 'en-GB' : 'ja-JP', {
    year: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  }).format(new Date(`${release.end}-01T00:00:00Z`));
  return (
    <div
      className="source-popover"
      id="source-information"
      popover="auto"
      role="region"
      aria-labelledby="source-heading"
    >
      <div className="popover-heading">
        <h2 id="source-heading">{t.title}</h2>
        <button
          className="text-button"
          popoverTarget="source-information"
          popoverTargetAction="hide"
          aria-label={t.close}
        >
          ×
        </button>
      </div>
      <p className="source-identity">{t.independent}</p>
      {children}
      <section aria-labelledby="source-freshness">
        <h3 id="source-freshness">{t.freshnessTitle}</h3>
        <dl className="source-facts">
          <dt>{t.latest}</dt>
          <dd data-testid="source-latest-month">{month}</dd>
          <dt>{t.downloaded}</dt>
          <dd data-testid="source-download-dates">
            {window
              ? `${date(window.first)}${date(window.first) === date(window.last) ? '' : ` – ${date(window.last)}`} (${t.japanTime})`
              : t.datesUnavailable}
          </dd>
        </dl>
        <p>{t.freshness}</p>
      </section>
      <section aria-labelledby="source-official">
        <h3 id="source-official">{t.sourceTitle}</h3>
        <p>{t.source}</p>
        <div className="source-links">
          <a
            href={
              locale === 'en'
                ? 'https://www.stat.go.jp/english/data/kouri/index.htm'
                : 'https://www.stat.go.jp/data/kouri/index.html'
            }
            target="_blank"
            rel="noreferrer"
          >
            {t.survey}
          </a>
          <a href="https://www.e-stat.go.jp/dbview?sid=0003421913" target="_blank" rel="noreferrer">
            {t.prices}
          </a>
        </div>
      </section>
      <section aria-labelledby="source-calculation">
        <h3 id="source-calculation">{t.calculationTitle}</h3>
        <p>{t.calculation}</p>
        <p>{t.definitions}</p>
      </section>
      <section aria-labelledby="source-estimates">
        <h3 id="source-estimates">{t.missingTitle}</h3>
        <p>{t.missing}</p>
        <p>{t.estimateMeaning}</p>
      </section>
      <section aria-labelledby="source-starter">
        <h3 id="source-starter">{t.starterTitle}</h3>
        <p>{t.starter}</p>
        <p>{t.assumptions}</p>
        <a href={DEFAULT_BASKET_SOURCE} target="_blank" rel="noreferrer">
          {t.purchases}
        </a>
      </section>
      <section aria-labelledby="source-coverage">
        <h3 id="source-coverage">{t.coverageTitle}</h3>
        <p>{t.coverage}</p>
        <p>
          {t.selectedCity}: {city.names[locale]} · {city.start} – {city.end}
        </p>
        <p>{t.interpretation}</p>
        <a
          href={
            locale === 'en'
              ? 'https://www.stat.go.jp/english/data/cpi/1585.htm'
              : 'https://www.stat.go.jp/data/cpi/4.html'
          }
          target="_blank"
          rel="noreferrer"
        >
          {t.cpi}
        </a>
      </section>
      <details className="source-technical">
        <summary>{t.technical}</summary>
        <dl className="source-facts">
          <dt>{t.release}</dt>
          <dd>{release.releaseId}</dd>
          <dt>{t.policy}</dt>
          <dd>{release.policyVersion}</dd>
        </dl>
      </details>
    </div>
  );
}
