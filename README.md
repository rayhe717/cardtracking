# F1 Trading Card Price Tracker

Local web app for screenshot-based F1 card price logging:

1. Upload screenshot
2. Crop listing area
3. OCR (`eng + chi_sim + chi_tra`)
4. LLM extraction + Chinese-to-English normalization
5. Fuzzy matching against local checklist
6. Human review/edit
7. Save to Notion (Card Registry + Price History + Portfolio Lots)

## Stack

- Frontend: React + Tailwind + CropperJS (`react-cropper`)
- Backend: Express
- OCR: `tesseract.js`
- Extraction: DeepSeek/OpenAI API with fallback heuristics
- Matching: `Fuse.js`
- Image processing: `sharp`
- Notion: `@notionhq/client`

## Setup

```bash
npm install
cp .env.example .env
```

Fill `.env` values:

- `PUBLIC_BASE_URL` (required for Notion image attachment, e.g. your ngrok/cloudflared URL)
- `LLM_PROVIDER` (`deepseek` or `openai`)
- `DEEPSEEK_API_KEY` (if using DeepSeek)
- `OPENAI_API_KEY` (if using OpenAI)
- `NOTION_API_KEY`
- `NOTION_CARD_REGISTRY_DB_ID`
- `NOTION_PRICE_HISTORY_DB_ID`
- `NOTION_PORTFOLIO_DB_ID` (required when saving `Buy` records)

Then run:

```bash
npm run dev
```

- Frontend: `http://localhost:5173`
- Backend: `http://localhost:4000`

## API Endpoints

- `POST /api/upload` (multipart `image`)
- `POST /api/crop` (`fileName`, crop box)
- `POST /api/ocr` (`fileName`)
- `POST /api/extract` (`ocrText`)
- `POST /api/save` (`entry`)

## Notion schema (important)

The app expects these properties:

- Card Registry DB:
  - `Card ID` (title)
  - `Set` (select)
  - `Driver` (select)
  - `Parallel` (select)
  - `Serial Print Run` (text)
  - `Current Market Price` (number)
  - `Last Market Date` (date)
- Price History DB:
  - `Card` (relation -> Card Registry)
  - `Date` (date)
  - `Price` (number)
  - `Currency` (select)
  - `Platform` (select: `eBay`, `Xianyu`, `Katao`, `Carousell`, `Others`)
  - `Record Type` (select: `Market`, `Buy`)
  - `Screenshot` (files)
  - `Notes` (text)
- Portfolio Lots DB:
  - `Lot ID` (title)
  - `Card` (relation -> Card Registry)
  - `Buy Date` (date)
  - `Buy Price` (number)
  - `Quantity` (number)
  - `Fees` (number)
  - `Status` (select: `Holding`, `Sold`)
  - `Notes` (text)

## Data Sources

- Dictionary CSV files at project root:
  - `drivers.csv`
  - `parallels.csv`
  - `sets.csv`
  - `card_terms.csv`
- Checklist JSON files in `database/`

## Notes

- If LLM extraction fails or no API key is configured, the backend falls back to heuristic extraction.
- Uploaded images are stored locally in `uploads/`.
- For Notion file attachments, `PUBLIC_BASE_URL` must be internet-reachable (Notion cannot fetch `localhost`).
- Saving with `Record Type = Buy` creates both a Price History row and a Portfolio Lots row.
- Saving with `Record Type = Market` updates `Current Market Price` and `Last Market Date` on the card.
