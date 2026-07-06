export async function runOxylabsSync(env: any) {
    const CATEGORIES = [
        "https://www.falconeurope.eu/cs/termovize/",
        "https://www.falconeurope.eu/cs/prislusenstvi/",
        "https://www.falconeurope.eu/cs/baterienabijeni/",
        "https://www.falconeurope.eu/cs/montaze/",
        "https://www.falconeurope.eu/cs/termovizni-monokulary/",
        "https://www.falconeurope.eu/cs/termovizni-optika/",
        "https://www.falconeurope.eu/cs/termovizni-pozorovaci-optika/"
    ];
    
    let totalSuccessCount = 0;
    const visitedUrls = new Set<string>();

    for (const catUrl of CATEGORIES) {
        try {
            console.log(`Scraping category: ${catUrl}`);
            const catRes = await fetch(catUrl);
            const catHtml = await catRes.text();

            const linkRegex = /<a[^>]*href="(\/cs\/[^"]+)"[^>]*>/gi;
            let match;
            const productUrls = [];
            while ((match = linkRegex.exec(catHtml)) !== null) {
                const link = match[1];
                // Ignore irrelevant links
                if (link.includes('/blog/') || link.includes('/login') || link.includes('/kosik') || link.includes('/registrace') || link.includes('?')) continue;
                // Only paths with exactly 2 slashes, e.g. /cs/falcon-medusa-m1/
                // -> split returns ["", "cs", "falcon-medusa-m1", ""] -> length 4
                if (link.split('/').length > 4) continue; 
                
                productUrls.push(`https://www.falconeurope.eu${link}`);
            }

            for (const pUrl of productUrls) {
                if (visitedUrls.has(pUrl)) continue;
                visitedUrls.add(pUrl);

                try {
                    console.log(`Fetching product: ${pUrl}`);
                    const pRes = await fetch(pUrl);
                    const pHtml = await pRes.text();

                    const skuMatch = pHtml.match(/"code":\s*"([^"]+)"/);
                    const sku = skuMatch ? skuMatch[1] : null;
                    if (!sku) continue; // Not a product page

                    const nameMatch = pHtml.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
                    const name = nameMatch ? nameMatch[1].trim() : null;

                    const descStart = pHtml.indexOf('<div class="description-inner">');
                    let description = '';
                    if (descStart !== -1) {
                        let descEnd = pHtml.length;
                        const endMarkers = [
                            '<div class="col-sm-12 "',
                            '<div id="productDiscussion"',
                            '<div class="extended-description"',
                            '<div class="p-detail-tabs-wrapper"',
                            '</section>'
                        ];
                        for (const marker of endMarkers) {
                            const idx = pHtml.indexOf(marker, descStart);
                            if (idx !== -1 && idx < descEnd) {
                                descEnd = idx;
                            }
                        }
                        
                        if (descEnd !== pHtml.length) {
                            description = pHtml.substring(descStart + 31, descEnd).trim();
                            // Clean up trailing divs
                            description = description.replace(/(<\/div>\s*)+$/, '').trim();
                        }
                    }

                    const imgMatch = pHtml.match(/<meta property="og:image" content="([^"]+)"/i);
                    const image_url = imgMatch ? imgMatch[1] : null;

                    const enrichedData = {
                        name,
                        description,
                        image_url
                    };

                    await env.PRODUCT_DB.put(sku, JSON.stringify(enrichedData));
                    console.log(`[Native Scraper] Synced SKU: ${sku}`);
                    totalSuccessCount++;
                } catch (e: any) {
                    console.error(`Failed to scrape product ${pUrl}: ${e.message}`);
                }
            }
        } catch (e: any) {
            console.error(`Error syncing category ${catUrl}: ${e.message}`);
        }
    }
    
    console.log(`Sync completed. Inserted/Updated ${totalSuccessCount} items.`);
    return totalSuccessCount;
}
