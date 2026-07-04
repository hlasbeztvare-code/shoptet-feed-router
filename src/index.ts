export interface Env {
  // Přidej vlastní proměnné prostředí (např. SHOPTET_URL), pokud potřebuješ
}

/**
 * Jednoduchý, ale robustní parser pro CSV (středník) schopný zpracovat 
 * streamovaná data i se zalomením řádků uvnitř uvozovek.
 */
class CSVStreamParser {
  private inQuote: boolean = false;
  private currentRow: string[] = [];
  private currentField: string = "";

  public parseChunk(chunk: string): string[][] {
    const rows: string[][] = [];
    for (let i = 0; i < chunk.length; i++) {
      const char = chunk[i];
      const nextChar = chunk[i + 1];

      if (char === '"') {
        // Zpracování escapovaných uvozovek ""
        if (this.inQuote && nextChar === '"') {
          this.currentField += '"';
          i++; 
        } else {
          this.inQuote = !this.inQuote;
        }
      } else if (char === ';' && !this.inQuote) {
        this.currentRow.push(this.currentField);
        this.currentField = "";
      } else if ((char === '\n' || char === '\r') && !this.inQuote) {
        if (char === '\r' && nextChar === '\n') {
          i++; // přeskočení \n po \r
        }
        this.currentRow.push(this.currentField);
        rows.push(this.currentRow);
        this.currentRow = [];
        this.currentField = "";
      } else {
        this.currentField += char;
      }
    }
    return rows;
  }

  public flush(): string[][] {
    if (this.currentField || this.currentRow.length > 0) {
      this.currentRow.push(this.currentField);
      const row = this.currentRow;
      this.currentRow = [];
      this.currentField = "";
      return [row];
    }
    return [];
  }
}

/**
 * Escapování speciálních znaků pro bezpečné XML
 */
function escapeXml(unsafe: string): string {
  if (!unsafe) return "";
  return unsafe.replace(/[<>&'"]/g, function (c) {
    switch (c) {
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '&': return '&amp;';
      case '\'': return '&apos;';
      case '"': return '&quot;';
      default: return c;
    }
  });
}

/**
 * The Cleaner: Vyčištění balastu z textu, odstranění scriptů a stylů, 
 * a příprava pro CDATA.
 */
function sanitizeHtml(html: string): string {
  if (!html) return "";
  let clean = html.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
  clean = clean.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '');
  clean = clean.replace(/<[^>]+>/g, ' '); // odstranění všech ostatních tagů
  clean = clean.replace(/\]\]>/g, ']]&gt;'); // Ochrana proti rozbití CDATA
  return clean.replace(/\s+/g, ' ').trim();
}

interface CsvIndices {
  code: number;
  name: number;
  ean: number;
  stock: number;
  defaultImage: number;
  price: number;
  description: number;
  link: number;
  manufacturer: number;
  params: { index: number; name: string }[];
}

/**
 * Převedení jednoho CSV řádku na XML fragment (Výchozí B2B)
 */
function mapRowToXml(row: string[], indices: CsvIndices): string {
  if (row.length <= 1) return ""; // Přeskočení prázdných řádků

  let xml = `  <SHOPITEM>\n`;
  
  if (indices.code >= 0 && row[indices.code]) xml += `    <CODE>${escapeXml(row[indices.code])}</CODE>\n`;
  if (indices.name >= 0 && row[indices.name]) xml += `    <NAME>${escapeXml(row[indices.name])}</NAME>\n`;
  if (indices.ean >= 0 && row[indices.ean]) xml += `    <EAN>${escapeXml(row[indices.ean])}</EAN>\n`;
  if (indices.stock >= 0 && row[indices.stock]) xml += `    <STOCK>${escapeXml(row[indices.stock])}</STOCK>\n`;
  if (indices.defaultImage >= 0 && row[indices.defaultImage]) xml += `    <DEFAULT_IMAGE>${escapeXml(row[indices.defaultImage])}</DEFAULT_IMAGE>\n`;
  if (indices.price >= 0 && row[indices.price]) xml += `    <PRICE>${escapeXml(row[indices.price])}</PRICE>\n`;
  
  if (indices.description >= 0 && row[indices.description]) {
    const cleanDesc = sanitizeHtml(row[indices.description]);
    xml += `    <DESCRIPTION><![CDATA[${cleanDesc}]]></DESCRIPTION>\n`;
  }

  let hasParams = false;
  let paramsXml = `    <TECHNICAL_PARAMETERS>\n`;
  for (const param of indices.params) {
    const val = row[param.index];
    if (val) {
      hasParams = true;
      paramsXml += `      <PARAM>\n        <NAME>${escapeXml(param.name)}</NAME>\n        <VALUE>${escapeXml(val)}</VALUE>\n      </PARAM>\n`;
    }
  }
  paramsXml += `    </TECHNICAL_PARAMETERS>\n`;

  if (hasParams) {
    xml += paramsXml;
  }

  xml += `  </SHOPITEM>\n`;
  return xml;
}

/**
 * Převedení jednoho CSV řádku na Alza/Heureka XML fragment
 */
function mapAlzaRow(row: string[], indices: CsvIndices): string {
  if (row.length <= 1) return "";

  let xml = `  <SHOPITEM>\n`;
  
  if (indices.code >= 0 && row[indices.code]) xml += `    <ITEM_ID>${escapeXml(row[indices.code])}</ITEM_ID>\n`;
  if (indices.name >= 0 && row[indices.name]) xml += `    <PRODUCTNAME>${escapeXml(row[indices.name])}</PRODUCTNAME>\n`;
  if (indices.description >= 0 && row[indices.description]) {
    const cleanDesc = sanitizeHtml(row[indices.description]);
    xml += `    <DESCRIPTION><![CDATA[${cleanDesc}]]></DESCRIPTION>\n`;
  }
  if (indices.link >= 0 && row[indices.link]) xml += `    <URL>${escapeXml(row[indices.link])}</URL>\n`;
  if (indices.defaultImage >= 0 && row[indices.defaultImage]) xml += `    <IMGURL>${escapeXml(row[indices.defaultImage])}</IMGURL>\n`;
  if (indices.price >= 0 && row[indices.price]) xml += `    <PRICE_VAT>${escapeXml(row[indices.price])}</PRICE_VAT>\n`;
  if (indices.ean >= 0 && row[indices.ean]) xml += `    <EAN>${escapeXml(row[indices.ean])}</EAN>\n`;
  if (indices.manufacturer >= 0 && row[indices.manufacturer]) xml += `    <MANUFACTURER>${escapeXml(row[indices.manufacturer])}</MANUFACTURER>\n`;
  xml += `    <CATEGORYTEXT>Termovize</CATEGORYTEXT>\n`;

  for (const param of indices.params) {
    const val = row[param.index];
    if (val) {
      xml += `    <PARAM>\n      <PARAM_NAME>${escapeXml(param.name)}</PARAM_NAME>\n      <VAL>${escapeXml(val)}</VAL>\n    </PARAM>\n`;
    }
  }

  xml += `  </SHOPITEM>\n`;
  return xml;
}

/**
 * Zpracování dat z ReadableStream po částech bez načtení všeho do paměti
 */
async function processStream(
  body: ReadableStream<Uint8Array>,
  writable: WritableStream<Uint8Array>,
  targetPriceCol: string,
  mode: "default" | "alza" = "default"
) {
  const writer = writable.getWriter();
  const encoder = new TextEncoder();
  const decoder = new TextDecoder("utf-8"); 

  try {
    // 1. Zápis hlavičky XML
    await writer.write(encoder.encode('<?xml version="1.0" encoding="utf-8"?>\n<SHOP>\n'));

    const csvParser = new CSVStreamParser();
    let headers: string[] | null = null;
    
    const indices: CsvIndices = {
      code: -1, name: -1, ean: -1, stock: -1, defaultImage: -1, price: -1, description: -1, link: -1, manufacturer: -1, params: []
    };

    const reader = body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      const rows = csvParser.parseChunk(chunk);

      let xmlChunk = "";

      for (const row of rows) {
        if (!headers) {
          // První řádek je hlavička, namapujeme indexy
          headers = row;
          console.log("DEBUG: Nalezene hlavicky v CSV:", headers.slice(0, 10), "...");
          indices.code = headers.indexOf("code");
          indices.name = headers.indexOf("name");
          indices.ean = headers.indexOf("ean");
          indices.stock = headers.indexOf("stock");
          indices.defaultImage = headers.indexOf("defaultImage");
          indices.description = headers.indexOf("description");
          indices.link = headers.indexOf("link");
          indices.manufacturer = headers.indexOf("manufacturer");
          indices.price = headers.indexOf(targetPriceCol);

          // Dynamické vyhledání parametric engine sloupců
          for (let i = 0; i < headers.length; i++) {
            if (headers[i].startsWith("filteringProperty:")) {
              indices.params.push({
                index: i,
                name: headers[i].replace("filteringProperty:", "").replace(/:$/, "")
              });
            }
          }
        } else {
          // Běžné řádky
          xmlChunk += mode === "alza" ? mapAlzaRow(row, indices) : mapRowToXml(row, indices);
        }
      }

      if (xmlChunk) {
        await writer.write(encoder.encode(xmlChunk));
      }
    }

    // Flushnutí zbytků dat z bufferů
    const finalChunk = decoder.decode();
    const rows = csvParser.parseChunk(finalChunk).concat(csvParser.flush());
    let xmlChunk = "";
    for (const row of rows) {
      if (headers) {
        xmlChunk += mode === "alza" ? mapAlzaRow(row, indices) : mapRowToXml(row, indices);
      }
    }
    if (xmlChunk) {
      await writer.write(encoder.encode(xmlChunk));
    }

    // 2. Ukončení XML tagu
    await writer.write(encoder.encode("</SHOP>\n"));
  } catch (error) {
    console.error("Stream processing error:", error);
  } finally {
    await writer.close();
  }
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    
    // Nejprve zkusíme načíst ID z URL cesty (např. /velkoobchod-28.xml)
    let feedId = url.pathname.replace(/^\//, '').replace(/\.xml$/, '');
    
    // Pokud cesta není specifikována, použijeme query parametry (zpětná kompatibilita)
    if (!feedId) {
      feedId = url.searchParams.get("feed") || url.searchParams.get("patternId") || "";
    }

    // 1. Ošetření chybného zadání ID
    if (!feedId) {
      return new Response("Missing feed identifier in URL path or parameters", { status: 400 });
    }

    interface PatternConfig {
      priceCol: string;
      sourceUrl: string;
      mode?: "default" | "alza";
    }

    const configMap: Record<string, PatternConfig> = {
      "alza": {
        priceCol: "price",
        sourceUrl: "https://www.falconeurope.eu/export/products.csv?patternId=23&partnerId=12&hash=1fce2ebcb6489b47ccc2f2375f0b7994ec7f3f4c6ee567b7ed20c04d49b15d9d",
        mode: "alza"
      },
      "velkoobchod-28": { 
        priceCol: "pricelist:2:price", 
        sourceUrl: "https://www.falconeurope.eu/export/products.csv?patternId=20&partnerId=12&hash=b8d97c9c31c81ff1c468ca7c3f7e79e28d4366ad39a96d25af1adf6949637852" 
      },
      "velkoobchod-30": { 
        priceCol: "pricelist:3:price", 
        sourceUrl: "https://www.falconeurope.eu/export/products.csv?patternId=17&partnerId=12&hash=a51b6830e2d0ddb69f93e9db8f1c0d14b641966bf38fdc4b3de48bf075bb06f2" 
      },
      "velkoobchod-35": { 
        priceCol: "pricelist:6:price", 
        sourceUrl: "https://www.falconeurope.eu/export/products.csv?patternId=11&partnerId=12&hash=550ad3ffc74884f81c120ab31035ade574ce99ae9a24e90be6973465d7a4ce72" 
      },
      "velkoobchod-38": { 
        priceCol: "pricelist:9:price", 
        sourceUrl: "https://www.falconeurope.eu/export/products.csv?patternId=8&partnerId=12&hash=b46ab9a54d0066a4b33916c13addfc05055ae7336099138e2ea268aa639f3ee3" 
      },
      "velkoobchod-40": { 
        priceCol: "pricelist:12:price", 
        sourceUrl: "https://www.falconeurope.eu/export/products.csv?patternId=14&partnerId=12&hash=cf6dfc1ce10d5005f10a19211960e763e1685abe9a98bf58b3ad6f82a630bde0" 
      },
    };

    const targetConfig = configMap[feedId];
    if (!targetConfig) {
      return new Response(`Feed '${feedId}' not found in configuration map`, { status: 404 });
    }

    const targetPriceCol = targetConfig.priceCol;
    const sourceUrl = targetConfig.sourceUrl;
    
    try {
      const shoptetResponse = await fetch(sourceUrl);
      
      if (!shoptetResponse.ok || !shoptetResponse.body) {
        return new Response(`Failed to fetch data from Shoptet: ${shoptetResponse.statusText}`, { status: 502 });
      }

      // 3. Vytvoření TransformStreamu
      // Data budou proudit z Readable (to je to, co vracíme v Response)
      // a naše processStream logika bude postupně zapisovat do Writable
      const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();

      // Zpracování streamu na pozadí, abychom mohli hned vrátit HTTP hlavičky
      // ctx.waitUntil zajistí, že Cloudflare nezabije instanci před dokončením streamu
      ctx.waitUntil(
        processStream(shoptetResponse.body, writable, targetPriceCol, targetConfig.mode || "default")
      );

      // 4. Návrat streamované odpovědi
      return new Response(readable, {
        headers: {
          "Content-Type": "application/xml; charset=utf-8",
          "Cache-Control": "max-age=3600"
        }
      });
    } catch (error) {
      return new Response("Internal Server Error", { status: 500 });
    }
  }
};
