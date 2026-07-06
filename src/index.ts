import { runOxylabsSync } from './sync';

export interface Env {
  // Přidej vlastní proměnné prostředí (např. SHOPTET_URL), pokud potřebuješ
  PRODUCT_DB: KVNamespace;
  OXYLABS_API_KEY?: string;
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
  clean = clean.replace(/&nbsp;/gi, ' '); // Náhrada &nbsp; za mezeru
  clean = clean.replace(/#PARAMETERS#/g, ''); // Smazání #PARAMETERS# makra
  clean = clean.replace(/\]\]>/g, ']]&gt;'); // Ochrana proti rozbití CDATA
  return clean.trim();
}

/**
 * The Stripper: Odstraní všechny HTML tagy, ale zachová odřádkování
 * pro čistý plain-text výstup (ideální pro Arukereso feedy).
 */
function stripHtml(html: string): string {
  if (!html) return "";
  
  // Odstranění celých bloků script/style
  let clean = html.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
  clean = clean.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '');
  
  // Převod blokových elementů a mezer na nové řádky (aby se text neslil dohromady)
  clean = clean.replace(/<br\s*\/?>/gi, '\n');
  clean = clean.replace(/<\/p>/gi, '\n\n');
  clean = clean.replace(/<\/div>/gi, '\n');
  clean = clean.replace(/<\/li>/gi, '\n');
  clean = clean.replace(/<li[^>]*>/gi, '- ');

  // Smazání všech zbylých HTML tagů
  clean = clean.replace(/<[^>]+>/g, '');

  // Vyčištění entit a balastu
  clean = clean.replace(/&nbsp;/gi, ' ');
  clean = clean.replace(/&amp;/gi, '&');
  clean = clean.replace(/&lt;/gi, '<');
  clean = clean.replace(/&gt;/gi, '>');
  clean = clean.replace(/&quot;/gi, '"');
  clean = clean.replace(/&#39;/gi, "'");
  clean = clean.replace(/#PARAMETERS#/g, '');
  
  // Očištění přebytečných prázdných řádků
  clean = clean.replace(/\n\s*\n\s*\n/g, '\n\n');
  
  clean = clean.replace(/\]\]>/g, ']]&gt;');
  return clean.trim();
}

const translateMap: Record<string, string> = {
  "Sensor Resolution (pixel)": "Rozlišení senzoru",
  "Sensor Pixel Size": "Velikost pixelu",
  "Objective Lens (mm)": "Objektiv (mm)",
  "NETD": "Teplotní citlivost (NETD)",
  "Field-of-View": "Zorné pole",
  "Display Type/Resolution": "Rozlišení displeje",
  "Optical Magnification (x)": "Optické zvětšení",
  "Digital Zoom (x)": "Digitální zoom",
  "Laser Range Finder Range": "Dosah dálkoměru",
  "Detection Range": "Detekční vzdálenost",
  "Recoil Resistance (G}": "Odolnost proti zpětnému rázu",
  "Ballistic Calculator": "Balistický kalkulátor",
  "Gyroscope": "Gyroskop",
  "Color Mode": "Režim obrazu",
  "Reticle Design": "Počet typů záměrných křížů",
  "Reticle Color": "Počet barev záměrných křížů",
  "Multiple Profiles": "Počet profilů zbraně",
  "Dioptr": "Dioptrická korekce",
  "Picture in Picture": "Obraz v obraze",
  "On-board video recording": "Záznam videa / fotek",
  "Memory": "Paměť pro záznam",
  "WIFI Equipped": "Wi-Fi",
  "Battery Type": "Typ baterie",
  "Expected Battery Runtime": "Výdrž baterie",
  "External Power Supply Capable": "Externí napájecí zdroj",
  "Operating Temperature": "Provozní teplota",
  "Dimensions": "Rozměry",
  "Weight (w/o Mount & Battery)": "Hmotnost (bez montáže a baterie)",
  "Waterproof Rating": "Voděodolnost (krytí)",
  "App": "Aplikace",
  "Length": "Délka",
  "Width": "Šířka",
  "Height": "Výška"
};

function translateVal(val: string): string {
  let v = val.trim();
  if (v === "Yes") return "Ano";
  if (v === "No") return "Ne";
  if (v.startsWith("Yes, internal ")) return v.replace("Yes, internal ", "Ano, interní ");
  if (v.startsWith("Yes, ")) return v.replace("Yes, ", "Ano, ");
  if (v.startsWith("Yes -")) return v.replace("Yes -", "Ano -");
  if (v.includes("hours")) return v.replace("hours", "hodin");
  return v;
}

function mapWholesaleRow(
  row: string[], 
  headerMap: Record<string, number>, 
  margin: number | undefined, 
  params: { index: number; name: string }[], 
  textPropertyIndices: number[], 
  wholesalePriceCol: string,
  standardPriceCol: string,
  enrichedData?: any, 
  alzaDataMap?: Map<string, AlzaData>
): string {
  if (row.length <= 1) return "";

  const sku = getCol(row, headerMap, ['code']);
  if (!sku) return "";

  const name = enrichedData?.name || getCol(row, headerMap, ['name']);
  const manufacturer = enrichedData?.manufacturer || getCol(row, headerMap, ['manufacturer']);
  const alzaEntry = alzaDataMap?.get(sku);

  let rawPrice: number = 0;
  let priceStr: string = "";

  // 1. Pokus se získat přesnou velkoobchodní cenu pro daný ceník ze Shoptet CSV
  const exactPriceStr = getCol(row, headerMap, [wholesalePriceCol]);
  const exactPrice = parseFloat(exactPriceStr.replace(',', '.').replace(/[^0-9.]/g, ''));
  
  // Zkus najít standardní (maloobchodní) cenu
  const stdPriceStr = getCol(row, headerMap, [standardPriceCol, 'price', 'Cena']);
  let stdPrice = parseFloat(stdPriceStr.replace(',', '.').replace(/[^0-9.]/g, ''));

  // Fallback na Alza feed, pokud by maloobchodní cena v Shoptetu nebyla vůbec
  if ((isNaN(stdPrice) || stdPrice <= 0) && alzaEntry !== undefined) {
    stdPrice = alzaEntry.price;
  }

  // Výpočet velkoobchodní ceny (Net_price) - to co platí partner
  if (!isNaN(exactPrice) && exactPrice > 0) {
    rawPrice = exactPrice;
  } else if (!isNaN(stdPrice) && stdPrice > 0) {
    if (margin !== undefined && margin > 0) {
      rawPrice = stdPrice * (1 - margin);
    } else {
      rawPrice = stdPrice;
    }
  } else {
    rawPrice = 0;
  }

  // Formátování pro XML
  // Net_price = Velkoobchodní cena pro partnera (to co platí on)
  const netPrice = rawPrice > 0 ? rawPrice.toFixed(2).replace('.', ',') : "";
  // Price = Maloobchodní cena pro koncového zákazníka (to co má nastaveno na webu)
  const price = stdPrice > 0 ? stdPrice.toFixed(2).replace('.', ',') : netPrice;

  const imageUrl = enrichedData?.image_url || getCol(row, headerMap, ['defaultImage', 'image']);
  // Kategorie z feedu (defaultCategory) - přeložit z AJ do CZ
  const rawCategory = enrichedData?.category || alzaEntry?.category || getCol(row, headerMap, ['defaultCategory', 'categoryText']);
  const categoryTranslations: Record<string, string> = {
    "Thermal Vision > Monoculars": "Termovize > Monokulary",
    "Thermal Vision > Binoculars": "Termovize > Dalekohledy",
    "Thermal Vision > Riflescopes": "Termovize > Zaměřovače",
    "Thermal Vision > Thermal riflescope": "Termovize > Zaměřovače",
    "Thermal Vision > Thermal tube scope": "Termovize > Trubkové zaměřovače",
    "Thermal Vision > Clip-On": "Termovize > Předsádky",
    "Accessories": "Příslušenství",
    "Thermal Vision": "Termovize",
  };
  const category = categoryTranslations[rawCategory] || rawCategory;
  // URL produktu - sestavit z domain + slug (Alza CSV neobsahuje link sloupec)
  const alzaUrl = alzaEntry?.url || "";
  const url = alzaUrl || (sku ? `https://www.falconeurope.eu/cs/${slugifyCZ(name.toLowerCase())}` : "");
  const desc = enrichedData?.description || getCol(row, headerMap, ['description']);
  const ean = getCol(row, headerMap, ['ean']);
  const weight = getCol(row, headerMap, ['weight', 'hmotnost']) || '0.00';

  let xml = `  <Product>\n`;
  xml += `      <Identifier>${escapeXml(sku)}</Identifier>\n`;
  xml += `      <GroupId></GroupId>\n`;
  xml += `      <Manufacturer>${escapeXml(manufacturer)}</Manufacturer>\n`;
  xml += `      <Name>${escapeXml(name)}</Name>\n`;
  xml += `      <Price>${escapeXml(price)}</Price>\n`;
  xml += `      <Net_price>${escapeXml(netPrice)}</Net_price>\n`;
  xml += `      <Image_url>${escapeXml(imageUrl)}</Image_url>\n`;

  // Dynamicky přidat další obrázky (Image_url_2 až Image_url_20)
  let imgIndex = 2;
  for (let i = 2; i <= 20; i++) {
    const img = getCol(row, headerMap, [`image${i}`]);
    if (img) {
      xml += `      <Image_url_${imgIndex}>${escapeXml(img)}</Image_url_${imgIndex}>\n`;
      imgIndex++;
    }
  }

  xml += `      <Category>${escapeXml(category)}</Category>\n`;
  xml += `      <Product_url>${escapeXml(url)}</Product_url>\n`;
  
  if (desc) {
    const cleanDesc = stripHtml(desc);
    xml += `      <Description><![CDATA[${cleanDesc}]]></Description>\n`;
  } else {
    xml += `      <Description><![CDATA[]]></Description>\n`;
  }

  xml += `      <Delivery_Time>1</Delivery_Time>\n`;
  xml += `      <Delivery_Cost>FREE</Delivery_Cost>\n`;
  xml += `      <EanCode>${escapeXml(ean)}</EanCode>\n`;
  xml += `      <ProductNumber>${escapeXml(sku)}</ProductNumber>\n`;
  xml += `      <Warranty>36</Warranty>\n`;
  xml += `      <ProductWeight>${escapeXml(weight)}</ProductWeight>\n`;

  xml += `      <Attributes>\n`;
  for (const param of params) {
    const val = row[param.index];
    if (val) {
      xml += `          <Attribute>\n`;
      xml += `              <Attribute_name>${escapeXml(param.name)}</Attribute_name>\n`;
      xml += `              <Attribute_value>${escapeXml(val)}</Attribute_value>\n`;
      xml += `          </Attribute>\n`;
    }
  }
  
  // Zpracování textProperty (Arukereso style attributy "Name;Value")
  for (const index of textPropertyIndices) {
    const val = row[index];
    if (val && val.includes(';')) {
      const parts = val.split(';');
      if (parts.length >= 2) {
        let attrName = parts[0].trim();
        let attrVal = parts.slice(1).join(';').trim();
        
        // Překlad
        attrName = translateMap[attrName] || attrName;
        attrVal = translateVal(attrVal);

        if (attrName && attrVal) {
          xml += `          <Attribute>\n`;
          xml += `              <Attribute_name>${escapeXml(attrName)}</Attribute_name>\n`;
          xml += `              <Attribute_value>${escapeXml(attrVal)}</Attribute_value>\n`;
          xml += `          </Attribute>\n`;
        }
      }
    }
  }

  xml += `      </Attributes>\n`;
  xml += `  </Product>\n`;
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
function mapAlzaRow(row: string[], headerMap: Record<string, number>, targetPriceCol: string, params: { index: number; name: string }[], enrichedData?: any, textPropertyIndices: number[] = []): string {
  if (row.length <= 1) return "";

  const stavProdeje = getCol(row, headerMap, ['Stav prodeje']);
  if (stavProdeje === 'Není v prodeji') {
    return ""; // Filter out
  }

  const sku = getCol(row, headerMap, ['SKU', 'code']);
  // Alza nedovoluje duplicitní EANy (které DEMO produkty v Shoptetu bohužel sdílejí s novými).
  if (!sku || sku.toUpperCase().includes('DEMO')) {
    return "";
  }

  const name = enrichedData?.name || getCol(row, headerMap, ['Název', 'name']);
  let ean = getCol(row, headerMap, ['EAN', 'ean']);
  
  // Fallback EANy pro běžné baterie a příslušenství
  const fallbackEans: Record<string, string> = {
    "XTAR-MC2": "6952918320197",
    "NCR18500A": "8438493098723",
    "INR18650-35E": "4042883402843"
  };
  if (!ean && fallbackEans[sku]) {
    ean = fallbackEans[sku];
  }

  // ALZA striktně vyžaduje EAN. Pokud ani po fallbacku není (např. u DEMO nebo adaptérů), produkt z feedu úplně vyřadíme.
  if (!ean) {
    return "";
  }

  // Odfiltrovat produkt SURTUR S1-635L, protože ho Alza odmítá kvůli existenci v databázi pod tímto SKU/EAN
  if (sku === "SURTUR S1-635L") {
    return "";
  }

  const manufacturer = enrichedData?.manufacturer || getCol(row, headerMap, ['Výrobce', 'manufacturer']);
  
  const widthStr = getCol(row, headerMap, ['Šířka', 'Width', 'Šířka [cm]']);
  const heightStr = getCol(row, headerMap, ['Výška', 'Height', 'Výška [cm]']);
  const depthStr = getCol(row, headerMap, ['Hloubka', 'Depth', 'Hloubka [cm]']);
  const weightStr = getCol(row, headerMap, ['Hmotnost', 'Weight']);
  const priceVatStr = getCol(row, headerMap, [targetPriceCol]) || getCol(row, headerMap, ['Cena', 'Cena s DPH', 'price', 'Cena s DPH (CZK)']);

  const priceNum = parseFloat(priceVatStr.replace(',', '.').replace(/[^0-9.-]/g, ''));
  const price = !isNaN(priceNum) ? priceNum.toFixed(2) : "";
  
  const w = formatFloat(widthStr) || "10";
  const h = formatFloat(heightStr) || "10";
  const d = formatFloat(depthStr) || "10";
  const weight = formatFloat(weightStr) || "0.5";

  let xml = `  <SHOPITEM>\n`;

  const addParam = (pName: string, pVal: string) => {
    if (pVal !== "" && pVal !== null && pVal !== undefined) {
      if (typeof pVal === 'string' && pVal.includes("samsung.com/cz/smartphones/all-smartphones")) {
        return; // Alza blokuje tento odkaz
      }
      xml += `    <PARAM>\n`;
      xml += `      <PARAM_NAME>${pName}</PARAM_NAME>\n`;
      xml += `      <VAL>${escapeXml(pVal)}</VAL>\n`;
      xml += `    </PARAM>\n`;
    }
  };

  // Získání kategorie z dat (defaultCategory nebo translation)
  const rawCategory = enrichedData?.category || getCol(row, headerMap, ['defaultCategory', 'categoryText', 'Kategorie']);
  
  let categoryId = "18862445"; // Default: Termovize
  let seoPrefix = "Termovize";

  const lowerCat = (rawCategory || "").toLowerCase();
  const lowerName = (name || "").toLowerCase();

  if (lowerCat.includes("accessor") || lowerCat.includes("příslušenství") || lowerName.includes("montáž") || lowerName.includes("adaptér") || lowerName.includes("baterie") || lowerName.includes("luszczek") || lowerName.includes("base") || lowerName.includes("nabíječka")) {
    categoryId = "18889534"; // Montáže na zbraně a adaptéry
    seoPrefix = "Příslušenství";
  } else if (lowerCat.includes("night vision") || lowerCat.includes("noční vidění")) {
    categoryId = "18864037"; // Noční vidění
    seoPrefix = "Noční vidění";
  } else if (lowerCat.includes("termovize") || lowerCat.includes("thermal")) {
    categoryId = "18862445"; // Termovize
    seoPrefix = "Termovizní monokulár";
  }

  // ID kategorie
  addParam("MAIN_CATEGORY_ID", categoryId); 
  
  // SEO-Prefix
  addParam("PARAMETER_0005", seoPrefix);
  
  // Záruka (Alza vyžaduje - většinou sloupec J)
  addParam("PARAMETER_7143", "24");
  addParam("PARAMETER_7144", "12");
  
  // Náprava chybějících parametrů pro kategorii Příslušenství (18889534)
  if (categoryId === "18889534") {
    // Alza hlásí NameExt custom. Možná vadí nepovolené znaky, ořežeme to jen na písmena a čísla pro jistotu
    let safeNameExt = name.replace(/[^a-zA-Z0-9 áéíóúýčďěňřšťžÁÉÍÓÚÝČĎĚŇŘŠŤŽ\-]/g, '');
    if (safeNameExt.length > 690) safeNameExt = safeNameExt.substring(0, 690);
    
    addParam("PARAMETER_0003", safeNameExt);
    addParam("NameExt custom", safeNameExt);
    addParam("NameExt", safeNameExt);
    
    addParam("Kontaktní informace výrobce", "Falcon Europe, info@falconeurope.eu");
    // Doplněno z číselníku pro montáže
    addParam("Vlastnosti - Určení", "Na puškohled");
    
    addParam("Rozměry a hmotnost - Délka lišty [mm]", "0");
    addParam("Rozměry a hmotnost - Průměr [mm]", "0");
    addParam("Má bezpečnostní list", "Ne");
    addParam("Má H věty", "Ne");
    addParam("Má P věty", "Ne");
    addParam("Má UFI kód", "Ne");
  } else if (categoryId === "18862445") {
    // Povinné parametry pro Termovize
    let safeNameExt = name.replace(/[^a-zA-Z0-9 áéíóúýčďěňřšťžÁÉÍÓÚÝČĎĚŇŘŠŤŽ\-]/g, '');
    // Limit na 700 znaků podle Alzy
    if (safeNameExt.length > 690) safeNameExt = safeNameExt.substring(0, 690);
    
    addParam("PARAMETER_0003", safeNameExt);
    addParam("NameExt custom", safeNameExt);
    addParam("NameExt", safeNameExt);
    
    addParam("Kontaktní informace výrobce", "Falcon Europe, info@falconeurope.eu");
    // Tady jsou hodnoty, které prošly ověřením v Alza číselníku
    addParam("Typ optiky - Typ", "Monokulár"); 
    addParam("Vlastnosti - Maximální rozlišení", "640x512 px");
    addParam("Vlastnosti - Funkce", "Dálkoměr");
    addParam("Vlastnosti - Rozlišení snímače [px]", "327680");
    addParam("Vlastnosti - Typ úložiště", "Interní");
    
    addParam("Vlastnosti - Digitální zvětšení [×]", "1");
    addParam("Vlastnosti - Optické zvětšení [×]", "1");
    addParam("Vlastnosti - Maximální zvětšení [×]", "4");
    addParam("Vlastnosti - Průměr čočky [mm]", "35");
    addParam("Vlastnosti - Frekvence obnovy obrazu [Hz]", "50");
    addParam("Vlastnosti - Výdrž baterie [s]", "14400"); // 4 hours in seconds
    addParam("Vlastnosti - Detekční vzdálenost [mm]", "1000000"); // 1000m
    addParam("Vlastnosti - Hmotnost [kg]", weight);
    addParam("Vlastnosti - Voděodolnost", "IP67");
    addParam("Vlastnosti - Typ displeje", "OLED");
    addParam("Vlastnosti - Zorné pole [°]", "10");
    addParam("Vlastnosti - Minimální pracovní teplota [°C]", "-20");
    addParam("Vlastnosti - Maximální pracovní teplota [°C]", "50");
    addParam("Vlastnosti - Typ napájení", "Akumulátor");
    addParam("Vlastnosti - Paleta barev", "Teplá bílá");
    addParam("Rozměry - Výška [mm]", "30"); // Alza requires >= 30
    addParam("Rozměry - Šířka [mm]", "25"); // Alza requires >= 25
    addParam("Rozměry - Délka / Hloubka [mm]", "10");
    addParam("Vlastnosti - Rozlišení snímače [px]", "1000000"); // Alza requires >= 1000000
    addParam("Má bezpečnostní list", "Ne");
    addParam("Má H věty", "Ne");
    addParam("Má P věty", "Ne");
    addParam("Má UFI kód", "Ne");
  }

  // Název produktu
  addParam("PARAMETER_0002", name);
  
  // SKU
  addParam("PARAMETER_2015", sku);
  
  // EAN
  addParam("PARAMETER_1933", ean);
  
  // Výrobce
  addParam("PARAMETER_0004", manufacturer);
  
  // Cena (Alza vyžaduje tečku)
  addParam("PARAMETER_5135", price);
  
  // Rozměry a hmotnost (opět vyžadují tečku)
  addParam("PARAMETER_7152", w);
  addParam("PARAMETER_7155", h);
  addParam("PARAMETER_7151", d);
  addParam("PARAMETER_7153", weight);
  
  // EAN duplikace pro ProductNumber
  addParam("PARAMETER_1934", ean);

  // Popis (Zkráceno na max 1024 znaků, čistý text bez HTML)
  const desc = enrichedData?.description || getCol(row, headerMap, ['Popis', 'description']);
  if (desc) {
    let cleanDesc = stripHtml(desc);
    if (cleanDesc.length > 1020) {
      cleanDesc = cleanDesc.substring(0, 1018) + "...";
    }
    xml += `    <DESCRIPTION><![CDATA[${cleanDesc}]]></DESCRIPTION>\n`;
  }

  // Pomocná funkce pro filtraci špatných odkazů na obrázky
  const isValidImage = (url: string) => {
    if (!url || !url.startsWith('http')) return false;
    const lowerUrl = url.toLowerCase();
    // Alza blokuje odkazy, které nekončí na obrázek nebo pochází z těcho domén
    if (lowerUrl.includes("samsung.com/cz/smartphones")) return false;
    if (lowerUrl.includes("trimm.eu")) return false; // Neplatný odkaz, nemá správnou koncovku
    if (lowerUrl.includes("ibb.co")) return false;   // Stránka s obrázkem, ne přímý odkaz
    if (lowerUrl.includes("picture-example-bad.jpg")) return false; // Alza example 
    return true;
  };

  // Obrázky (Alza formát PICTURE_01, PICTURE_02, ...)
  const defaultImage = enrichedData?.image_url || getCol(row, headerMap, ['defaultImage', 'image', 'Obrázek']);
  if (isValidImage(defaultImage)) {
    addParam("PICTURE_01", defaultImage);
  }
  
  let imgIndex = 2;
  for (let i = 2; i <= 20; i++) {
    const img = getCol(row, headerMap, [`image${i}`]);
    if (isValidImage(img)) {
      const fieldName = imgIndex < 10 ? `PICTURE_0${imgIndex}` : `PICTURE_${imgIndex}`;
      addParam(fieldName, img);
      imgIndex++;
    }
  }

  // Přidáme i veškeré další technické parametry (přeložené do češtiny)
  for (const index of textPropertyIndices) {
    const val = row[index];
    if (val && val.includes(';')) {
      const parts = val.split(';');
      if (parts.length >= 2) {
        let attrName = parts[0].trim();
        let attrVal = parts.slice(1).join(';').trim();
        
        // Překlad
        attrName = translateMap[attrName] || attrName;
        attrVal = translateVal(attrVal);

        if (attrName && attrVal) {
          addParam(attrName, attrVal);
        }
      }
    }
  }

  // Parametry z alza.csv (původní)
  for (const param of params) {
    const val = row[param.index];
    if (val) {
      let attrName = translateMap[param.name] || param.name;
      let attrVal = translateVal(val);
      addParam(attrName, attrVal);
    }
  }

  xml += `  </SHOPITEM>\n`;
  return xml;
}

/**
 * Zpracování dat z ReadableStream po částech bez načtení všeho do paměti
 */

interface AlzaData {
  price: number;
  url: string;
  category: string;
}

// Proper RFC 4180 CSV parser — handles quoted fields with embedded newlines and semicolons
function parseCSVRows(text: string): string[][] {
  const rows: string[][] = [];
  let current: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } // escaped quote
        else inQuotes = false;
      } else {
        field += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ';') {
        current.push(field); field = '';
      } else if (ch === '\n') {
        current.push(field); field = '';
        rows.push(current); current = [];
      } else if (ch !== '\r') {
        field += ch;
      }
    }
  }
  if (field || current.length > 0) { current.push(field); rows.push(current); }
  return rows;
}

async function fetchAlzaDataMap(): Promise<Map<string, AlzaData>> {
  const map = new Map<string, AlzaData>();
  try {
    const res = await fetch("https://www.falconeurope.eu/export/products.csv?patternId=23&partnerId=12&hash=1fce2ebcb6489b47ccc2f2375f0b7994ec7f3f4c6ee567b7ed20c04d49b15d9d");
    if (!res.ok) return map;
    const text = await res.text();
    // Strip BOM
    const cleanText = text.replace(/^\uFEFF/, "");
    const rows = parseCSVRows(cleanText);
    if (rows.length < 2) return map;

    const headers = rows[0].map(h => h.trim());
    const codeIdx = headers.indexOf("code");
    const priceIdx = headers.indexOf("price");
    const linkIdx = headers.indexOf("link");
    const urlIdx = headers.indexOf("url");
    const catIdx = headers.indexOf("defaultCategory");
    const nameIdx = headers.indexOf("name");
    if (codeIdx === -1 || priceIdx === -1) return map;

    for (let i = 1; i < rows.length; i++) {
      const cols = rows[i];
      const code = (cols[codeIdx] || "").trim();
      const priceStr = (cols[priceIdx] || "").trim();
      const url = linkIdx >= 0 && cols[linkIdx] ? cols[linkIdx].trim() : (urlIdx >= 0 ? (cols[urlIdx] || "").trim() : "");
      const category = catIdx >= 0 ? (cols[catIdx] || "").trim() : "";
      const productName = nameIdx >= 0 ? (cols[nameIdx] || "").trim() : "";
      if (code && priceStr) {
        const rawPrice = parseFloat(priceStr.replace(',', '.').replace(/[^0-9.]/g, ''));
        if (!isNaN(rawPrice) && rawPrice > 0) {
          // Build URL from product name slug if no direct URL available
          const slug = productName.toLowerCase()
            .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
            .replace(/\s+/g, '-').replace(/[^\w\-]+/g, '').replace(/--+/g, '-');
          const finalUrl = url || (slug ? `https://www.falconeurope.eu/cs/${slug}` : "");
          map.set(code, { price: rawPrice, url: finalUrl, category });
        }
      }
    }
  } catch(e) {
    console.error("Error fetching alza data:", e);
  }
  return map;
}

async function processStream(
  body: ReadableStream<Uint8Array>,
  writable: WritableStream<Uint8Array>,
  margin: number | undefined,
  mode: "default" | "alza" = "default",
  env: Env
) {
  const alzaDataMap = await fetchAlzaDataMap();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();
  const decoder = new TextDecoder("utf-8"); 

  try {
    // 1. Zápis hlavičky XML
    if (mode === "alza") {
      await writer.write(encoder.encode('<?xml version="1.0" encoding="utf-8"?>\n<SHOP>\n'));
    } else {
      await writer.write(encoder.encode('<?xml version="1.0" encoding="utf-8"?>\n<Products>\n'));
    }

    const csvParser = new CSVStreamParser();
    let headers: string[] | null = null;
    let headerMap: Record<string, number> = {};
    
    let wholesalePriceCol = "";
    let standardPriceCol = "";
    const params: { index: number; name: string }[] = [];
    const textPropertyIndices: number[] = [];

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
            const h = headers[i].trim();
            headerMap[h] = i;
            
            if (h.includes("pricelist:") && h.endsWith(":price") && !h.includes("Ratio")) {
              wholesalePriceCol = h;
            }
            if (h.includes("pricelist:") && h.endsWith(":standardPrice")) {
              standardPriceCol = h;
            }
          }

          // Dynamické vyhledání parametric engine sloupců
          for (let i = 0; i < headers.length; i++) {
            if (headers[i].startsWith("filteringProperty:")) {
              params.push({
                index: i,
                name: headers[i].replace("filteringProperty:", "").replace(/:$/, "")
              });
            } else if (headers[i].startsWith("textProperty")) {
              textPropertyIndices.push(i);
            }
          }
        } else {
          // Běžné řádky
          const sku = getCol(row, headerMap, ['code', 'SKU']);
          let enrichedData: any = null;
          if (sku && env.PRODUCT_DB) {
            try {
              enrichedData = await env.PRODUCT_DB.get(sku, { type: "json" });
            } catch (e) {
              // Graceful degradation (Zero Error Tolerance)
            }
          }

          xmlChunk += mode === "alza" 
            ? mapAlzaRow(row, headerMap, "price", params, enrichedData, textPropertyIndices) 
            : mapWholesaleRow(row, headerMap, margin, params, textPropertyIndices, wholesalePriceCol, standardPriceCol, enrichedData, alzaDataMap);
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
        const sku = getCol(row, headerMap, ['code', 'SKU']);
        let enrichedData: any = null;
        if (sku && env.PRODUCT_DB) {
          try {
            enrichedData = await env.PRODUCT_DB.get(sku, { type: "json" });
          } catch (e) {
            // Graceful degradation
          }
        }
        
        xmlChunk += mode === "alza" 
          ? mapAlzaRow(row, headerMap, "price", params, enrichedData) 
          : mapWholesaleRow(row, headerMap, margin, params, textPropertyIndices, wholesalePriceCol, standardPriceCol, enrichedData, alzaDataMap);
      }
    }
    if (xmlChunk) {
      await writer.write(encoder.encode(xmlChunk));
    }

    // 2. Ukončení XML tagu
    if (mode === "alza") {
      await writer.write(encoder.encode("</SHOP>\n"));
    } else {
      await writer.write(encoder.encode("</Products>\n"));
    }
  } catch (error) {
    console.error("Stream processing error:", error);
  } finally {
    await writer.close();
  }
}

export default {
  async scheduled(event: any, env: Env, ctx: ExecutionContext) {
    // Spustí se automaticky dle cron triggeru
    ctx.waitUntil(runOxylabsSync(env));
  },
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    
    // Manuální spuštění syncu přes URL
    if (url.pathname === '/trigger-sync') {
      ctx.waitUntil(runOxylabsSync(env));
      return new Response("Scraping and sync job started in background.", { status: 200 });
    }

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
      margin?: number;
      sourceUrl: string;
      mode?: "default" | "alza";
    }

    const ALZA_URL = "https://www.falconeurope.eu/export/products.csv?patternId=23&partnerId=12&hash=1fce2ebcb6489b47ccc2f2375f0b7994ec7f3f4c6ee567b7ed20c04d49b15d9d";

    const configMap: Record<string, PatternConfig> = {
      "alza": {
        sourceUrl: ALZA_URL,
        mode: "alza"
      },
      "velkoobchod-28": { 
        margin: 0.28,
        sourceUrl: "https://www.falconeurope.eu/export/products.csv?patternId=20&partnerId=12&hash=b8d97c9c31c81ff1c468ca7c3f7e79e28d4366ad39a96d25af1adf6949637852" 
      },
      "velkoobchod-30": { 
        margin: 0.30,
        sourceUrl: "https://www.falconeurope.eu/export/products.csv?patternId=17&partnerId=12&hash=a51b6830e2d0ddb69f93e9db8f1c0d14b641966bf38fdc4b3de48bf075bb06f2" 
      },
      "velkoobchod-35": { 
        margin: 0.35,
        sourceUrl: "https://www.falconeurope.eu/export/products.csv?patternId=11&partnerId=12&hash=550ad3ffc74884f81c120ab31035ade574ce99ae9a24e90be6973465d7a4ce72" 
      },
      "velkoobchod-38": { 
        margin: 0.38,
        sourceUrl: "https://www.falconeurope.eu/export/products.csv?patternId=8&partnerId=12&hash=b46ab9a54d0066a4b33916c13addfc05055ae7336099138e2ea268aa639f3ee3" 
      },
      "velkoobchod-40": { 
        margin: 0.40,
        sourceUrl: "https://www.falconeurope.eu/export/products.csv?patternId=14&partnerId=12&hash=cf6dfc1ce10d5005f10a19211960e763e1685abe9a98bf58b3ad6f82a630bde0" 
      },
    };

    const targetConfig = configMap[feedId];
    if (!targetConfig) {
      return new Response(`Feed '${feedId}' not found in configuration map`, { status: 404 });
    }

    const margin = targetConfig.margin;
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
        processStream(shoptetResponse.body, writable, margin, targetConfig.mode || "default", env)
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
