import { 
  OxylabsAIStudioSDK, 
  OutputFormat
} from 'oxylabs-ai-studio';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

const sdk = new OxylabsAIStudioSDK({apiKey: "3477VGEKn5YmGdgxQoHjr44bWgPUAzxod6JCgNAZ"});
const timeout = 120000;

// Seznam URL, které se mají proškrábat
const URLS_TO_SCRAPE = [
    "https://www.falconeurope.eu/cs/termovize/",
    // "https://www.falconeurope.eu/cs/prislusenstvi/",
    // Přidej sem další kategorie nebo konkrétní URL
];

async function scrapeWithUserInputs() {
  const tempDir = path.join(__dirname, '..', '.tmp_kv');
  if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir);
  }

  let totalSuccessCount = 0;

  for (const targetUrl of URLS_TO_SCRAPE) {
    try {
      console.log(`\n==================================================`);
      console.log(`Scraping URL: ${targetUrl}`);
      console.log(`==================================================`);
      
      const payload = {
      "url": targetUrl,
      "output_format": "json",
      "schema": {
          "type": "object",
          "properties": {
              "items": {
                  "type": "array",
                  "items": {
                      "type": "object",
                      "properties": {
                          "sku": {
                              "type": "string",
                              "description": "Kód produktu"
                          },
                          "ean": {
                              "type": "string",
                              "description": "EAN kód, pokud je dostupný"
                          },
                          "meta": {
                              "type": "object",
                              "properties": {
                                  "scraped_at": {
                                      "type": "string"
                                  },
                                  "version": {
                                      "type": "string"
                                  }
                              }
                          },
                          "cz_content": {
                              "type": "object",
                              "properties": {
                                  "name": {
                                      "type": "string",
                                      "description": "Název produktu"
                                  },
                                  "description": {
                                      "type": "string",
                                      "description": "Kompletní popisek produktu"
                                  },
                                  "category": {
                                      "type": "string",
                                      "description": "Kategorie produktu"
                                  }
                              }
                          },
                          "attributes": {
                              "type": "array",
                              "description": "Seznam VŠECH technických parametrů nalezených na stránce (rozlišení, čočky, senzory, hmotnost, atd.)",
                              "items": {
                                  "type": "object",
                                  "properties": {
                                      "name": {
                                          "type": "string"
                                      },
                                      "value": {
                                          "type": "string"
                                      }
                                  }
                              }
                          },
                          "warranty": {
                              "type": "string",
                              "description": "Informace o záruce"
                          },
                          "package_contents": {
                              "type": "array",
                              "description": "Seznam položek obsažených v balení",
                              "items": {
                                  "type": "string"
                              }
                          },
                          "media": {
                              "type": "object",
                              "properties": {
                                  "main_image": {
                                      "type": "string",
                                      "format": "uri",
                                      "description": "Absolutní URL hlavní fotky. Musí končit na .png, .jpg nebo .webp."
                                  },
                                  "gallery": {
                                      "type": "array",
                                      "description": "Seznam URL všech dalších fotek produktu.",
                                      "items": {
                                          "type": "string",
                                          "format": "uri"
                                      }
                                  }
                              }
                          }
                      }
                  }
              }
          }
      },
      "render_javascript": "auto",
      "geo_location": "Czechia"
  };
      
      const results: any = await sdk.aiScraper.scrape(payload, timeout);
      console.log(`Scraping successful for ${targetUrl}!`);

      let items: any[] = [];
      if (results?.items) items = results.items;
      else if (results?.content?.items) items = results.content.items;
      else if (results?.data?.items) items = results.data.items;
      else if (Array.isArray(results)) items = results;

      if (!items || items.length === 0) {
          console.error(`No items found for ${targetUrl}. Skipping...`);
          continue;
      }

      console.log(`Found ${items.length} items. Pushing to KV store...`);

      let successCount = 0;
      for (const item of items) {
          const sku = item.sku;
          if (!sku) {
              console.log('Skipping item without SKU:', item);
              continue;
          }

          const enrichedData = {
              name: item.cz_content?.name,
              description: item.cz_content?.description,
              category: item.cz_content?.category,
              image_url: item.media?.main_image,
              attributes: item.attributes,
          };

          const tmpFilePath = path.join(tempDir, `${sku}.json`);
          fs.writeFileSync(tmpFilePath, JSON.stringify(enrichedData));

          try {
              execSync(`npx wrangler kv key put --binding PRODUCT_DB "${sku}" --path "${tmpFilePath}" --remote`, { stdio: 'pipe' });
              console.log(`✅ SKU ${sku} injected successfully.`);
              successCount++;
          } catch (err: any) {
              console.error(`❌ Failed to inject SKU ${sku}:`, err.message);
          }
      }
      totalSuccessCount += successCount;
      
    } catch (error: any) {
      console.error(`Scraping error for ${targetUrl}:`, error.message);
    }
  }

  console.log(`\n🎉 All done! Successfully pushed a total of ${totalSuccessCount} items to Cloudflare KV.`);
}

scrapeWithUserInputs();
