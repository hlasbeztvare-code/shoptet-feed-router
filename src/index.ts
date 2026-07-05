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
  clean = clean.replace(/&nbsp;/gi, ' '); // Náhrada &nbsp; za mezeru
  clean = clean.replace(/#PARAMETERS#/g, ''); // Smazání #PARAMETERS# makra
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

function slugifyCZ(text: string): string {
  return text.toString().toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, '-')
    .replace(/[^\w\-]+/g, '')
    .replace(/\-\-+/g, '-')
    .replace(/^-+/, '')
    .replace(/-+$/, '');
}

function getCol(row: string[], headerMap: Record<string, number>, colNames: string[]): string {
  for (const name of colNames) {
    const idx = headerMap[name];
    if (idx !== undefined && row[idx] !== undefined) {
      return row[idx].trim();
    }
  }
  return "";
}

function formatFloat(val: string): string {
  if (!val) return '';
  const str = val.replace(',', '.').replace(/[^0-9.-]/g, '');
  const num = parseFloat(str);
  return isNaN(num) ? '' : num.toString();
}

/**
 * Převedení jednoho CSV řádku na Alza XML fragment (Nový standard)
 */
function mapAlzaRow(row: string[], headerMap: Record<string, number>): string {
  if (row.length <= 1) return "";

  const stavProdeje = getCol(row, headerMap, ['Stav prodeje']);
  if (stavProdeje === 'Není v prodeji') {
    return ""; // Filter out
  }

  const sku = getCol(row, headerMap, ['SKU', 'code']);
  if (!sku) return "";

  const name = getCol(row, headerMap, ['Název', 'name']);
  const slug = name ? slugifyCZ(name) : sku;
  const url = `https://falconeurope.eu/produkt/${slug}`;

  const ean = getCol(row, headerMap, ['EAN', 'ean']);
  const manufacturer = getCol(row, headerMap, ['Výrobce', 'manufacturer']);
  const alzaCode = getCol(row, headerMap, ['Alza kód produktu']);
  
  const widthStr = getCol(row, headerMap, ['Šířka', 'Width', 'Šířka [cm]']);
  const heightStr = getCol(row, headerMap, ['Výška', 'Height', 'Výška [cm]']);
  const depthStr = getCol(row, headerMap, ['Hloubka', 'Depth', 'Hloubka [cm]']);
  const weightStr = getCol(row, headerMap, ['Hmotnost', 'Weight']);
  const status = getCol(row, headerMap, ['Stav']);
  const priceVatStr = getCol(row, headerMap, ['Cena', 'Cena s DPH', 'price', 'Cena s DPH (CZK)']);

  let xml = `  <SHOPITEM>\n`;
  xml += `    <ITEM_ID>${escapeXml(sku)}</ITEM_ID>\n`;
  xml += `    <PRODUCTNAME>${escapeXml(name)}</PRODUCTNAME>\n`;
  xml += `    <URL>${escapeXml(url)}</URL>\n`;
  if (ean) xml += `    <EAN>${escapeXml(ean)}</EAN>\n`;
  if (manufacturer) xml += `    <MANUFACTURER>${escapeXml(manufacturer)}</MANUFACTURER>\n`;
  if (alzaCode) xml += `    <ALZA_CODE>${escapeXml(alzaCode)}</ALZA_CODE>\n`;

  const w = formatFloat(widthStr);
  const h = formatFloat(heightStr);
  const d = formatFloat(depthStr);
  if (w) xml += `    <WIDTH>${w}</WIDTH>\n`;
  if (h) xml += `    <HEIGHT>${h}</HEIGHT>\n`;
  if (d) xml += `    <DEPTH>${d}</DEPTH>\n`;

  const weight = formatFloat(weightStr);
  if (weight) xml += `    <WEIGHT>${weight}</WEIGHT>\n`;
  
  if (status) xml += `    <STATUS>${escapeXml(status)}</STATUS>\n`;

  const price = formatFloat(priceVatStr);
  if (price) {
    const priceNum = parseFloat(price);
    xml += `    <PRICE_VAT>${priceNum.toFixed(2)}</PRICE_VAT>\n`;
  }

  xml += `    <DELIVERY_DATE>0</DELIVERY_DATE>\n`;

  const desc = getCol(row, headerMap, ['Popis', 'description']);
  if (desc) {
    const cleanDesc = sanitizeHtml(desc);
    xml += `    <DESCRIPTION><![CDATA[${cleanDesc}]]></DESCRIPTION>\n`;
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
    let headerMap: Record<string, number> = {};
    
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
          
          for (let i = 0; i < headers.length; i++) {
            headerMap[headers[i].trim()] = i;
          }

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
          xmlChunk += mode === "alza" ? mapAlzaRow(row, headerMap) : mapRowToXml(row, indices);
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
        xmlChunk += mode === "alza" ? mapAlzaRow(row, headerMap) : mapRowToXml(row, indices);
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
