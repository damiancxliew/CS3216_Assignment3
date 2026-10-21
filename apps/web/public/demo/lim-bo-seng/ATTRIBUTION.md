# Historical image assets

Verified 20 October 2026. These are historical records, not AI images. Game maps are separate code-authored reconstructions.

## portrait.jpg

- Subject: Lim Bo Seng; Commons dates the portrait to the 1930s.
- Original: https://upload.wikimedia.org/wikipedia/commons/e/e7/LimBoSeng-1930s.jpg
- Record: https://commons.wikimedia.org/wiki/File:LimBoSeng-1930s.jpg
- Record designation: PD-BritishGov / expired Crown copyright. The original photographer is not identified; uploader attribution must not be read as photographer attribution.
- Stored file unchanged. Role brief, introductions and source card display the complete image with proportional sizing.
- Provenance caution: the record's original uploader description is sparse. The page's public-domain designation is recorded here, not an independently established chain of original authorship.

## surrender.png

- Subject: British troops surrendering in Singapore city area, 15 February 1942.
- Australian War Memorial ID 127902; unknown photographer.
- Original: https://upload.wikimedia.org/wikipedia/commons/f/fb/British_troops_surrender_in_Singapore.png
- Record: https://commons.wikimedia.org/wiki/File:British_troops_surrender_in_Singapore.png
- Record designation: public domain, expired Australian Crown copyright; record notes worldwide expiry confirmation.
- Stored unchanged; role brief and introductions preserve the complete image. Do not caption this as Lim's departure or as civilian daily life.

## currency.jpg

- Subject: Japanese occupation Malaya ten-cent note, 1942; modern scan, 2015.
- Credit: National Numismatic Collection, National Museum of American History. Scan by Godot13.
- Original: https://upload.wikimedia.org/wikipedia/commons/e/e9/MAL-M3b-Malaya-Japanese_Occupation-10_Cents_ND_%281942%29.jpg
- Record: https://commons.wikimedia.org/wiki/File:MAL-M3b-Malaya-Japanese_Occupation-10_Cents_ND_(1942).jpg
- Scan license: [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/). Record also documents underlying public-domain status.
- Stored and displayed unchanged except proportional sizing. This note is ten cents, not the ten-dollar note with a banana-tree motif.

## Existing ambience

`/game/ninja/audio/sfx/wind.ogg` is reused from the repository's existing Ninja Adventure collection. Its existing `game/ninja/LICENSE.txt` and README remain authoritative. No historical authenticity is claimed for the ambience.

The portraits below are connected for the requested local demo. Their source cards retain the full photographs, dates, credits and access conditions. This implementation does not establish redistribution permission for NAS photographs.

## Historical chatbot avatars (`portraits/*.webp`)

Verified 21 October 2026. Originals were converted to WebP without retouching or removing watermarks. Avatar framing is CSS only; the archive displays the complete photographs.

- `lim.webp`: the same 1930s portrait as `portrait.jpg` above.
- `gan.webp`: Gan Choo Neo at far right in black, Lim Bo Seng’s funeral, 13 January 1946. NAS image 20080000015-0099, reference 30010. Tham Sien Yen Collection, courtesy of National Archives of Singapore. [Record](https://www.nas.gov.sg/archivesonline/photographs/record-details/9e4a7381-1162-11e3-83d5-0050568939ad). [Original](https://www.nas.gov.sg/archivesonline/watermark/picas_data/tn_pcd/20080000015-6258-2121-9782/img0099.jpg).
- `tham.webp`: Tham Sien Yen shaking hands with Mountbatten in London, 8 June 1946; Tham is in the right foreground. NAS image 20080000015-0103, reference 35001. Tham Sien Yen Collection, courtesy of National Archives of Singapore. [Record](https://www.nas.gov.sg/archivesonline/photographs/record-details/9eb7c379-1162-11e3-83d5-0050568939ad). [Original](https://www.nas.gov.sg/archivesonline/watermark/picas_data/tn_pcd/20080000015-6258-2121-9782/img0103.jpg).
- Both NAS records permit viewing and require written copyright-owner permission for commercial use and reproduction. **No such permission has been obtained. These assets are not cleared for redistribution or commercial publication.** Both photographs postdate the occupation.
- `tan.webp`: Tan Chong Tee, 2 November 1936; unknown photographer, The Straits Times. [Record](https://commons.wikimedia.org/wiki/File:Tan_Chong_Tee.jpg). [Original](https://upload.wikimedia.org/wikipedia/commons/3/31/Tan_Chong_Tee.jpg). Commons designates PD-SG-photo. Sporting clothing in the photo is not a military uniform.
- `elizabeth.webp`: Elizabeth Choy’s wedding photograph, 16 August 1941; credited to her family. [Record](https://commons.wikimedia.org/wiki/File:Elizabeth_Choy,_1941.jpg). [Original](https://upload.wikimedia.org/wikipedia/commons/0/03/Elizabeth_Choy%2C_1941.jpg). Commons designates PD-SG-photo. The wedding dress is not presented as everyday wartime clothing.

## Likeness-based character sprites (`sprites/*.png`)

AI-generated illustrations using the corresponding photographs as visual references, generated with the built-in image tool. These are not historical evidence. Facial likeness is stylised; colours, unseen angles and walking phases are reconstructed. Gan’s dark outfit and Tham’s field cap reference their post-war photos. Elizabeth’s everyday teal blouse/navy skirt and Tan’s olive field clothing are illustrative choices. Lim’s cream shirt, glasses and side-parted hair follow his portrait.

Original outputs and exact prompts are preserved in `docs/standalone-demo/artwork/` and `docs/standalone-demo/character-art-prompts.md`. `scripts/pack-history-character-sheets.mjs` aligns the transparent frames for the existing engine: 256×256 sheet, four 64px direction columns (down/up/left/right), four walking-phase rows, drawn at the existing 16px world footprint. No generation changes apply to ordinary v2/v3 adventures.

## Illustrated map assets

`map/*.svg` are original code-authored pixel illustrations generated by `scripts/build-history-demo-art.mjs`. They are game scenery, not historical photographs or reproductions of identified artefacts. Shophouse architecture references NHB's *The Singapore Shophouses* and URA conservation guidance (links in `docs/standalone-demo/design.md`). Designs, layouts and colour choices are illustrative. They may be regenerated deterministically; no image-generation service is used.

## Compact waterfront art

`map/river-*.svg`, `map/quay-step.svg`, `map/mooring.svg`, `map/newsstand.svg`, `map/household-parcels.svg` and `map/boarding-sign.svg` are code-authored illustrations from `scripts/build-waterfront-art.mjs`, extending the existing SVG art style. Architecture references and historical limitations are recorded in `docs/standalone-demo/design.md`. Shop signs describe illustrative building functions, not verified businesses. No archival photographs were transformed into this scenery. The departure animation reuses these assets and the attributed generated character sprites; it is not historical film.
