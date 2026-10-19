# Subtitle Cleaning Agent Guidelines

Instructions and prompt directives for AI agents cleaning and fixing automated Indonesian stock trading transcripts in this repository.

---

## 1. Agent Prompt Template

When instructing an AI agent to clean or fix transcripts, use the following prompt:

```text
Please clean and fix the automated Indonesian subtitle transcripts (.txt) in this project.

### Execution Model:
- Use AI Agents / Subagents, NOT Python scripts. You are fully authorized and encouraged to spawn as many parallel subagents as needed and consume as many tokens as necessary to achieve 100% accuracy.
- The input files are plain text transcripts (.txt) without timestamps.
- Clean the text line-by-line or paragraph-by-paragraph, preserving 100% verbatim sentence structure. Do NOT summarize, truncate, rewrite, or paraphrase.

### Reference Data:
Prioritize the JSON files in the `data/` directory for phonetic mappings, dictionary lookups, and terminology rules:

1. `data/idx_terms.json`:
   - Use for common Automated Speech Recognition (ASR) typos, trading slang, and phonetic variations.
   - Examples: "arah" -> ARA, "arab" -> ARB, "haka", "haki", "tp" -> TP, "sl" -> SL, "fca" -> FCA, "rups" -> RUPS, "ath" -> ATH, "atl" -> ATL.

2. `data/idx_stocks.json`:
   - Use for 4-letter Indonesian stock tickers and company names.
   - Capitalize valid tickers when mentioned in trading contexts (e.g., BBCA, BBRI, BUMI, BRMS, ADRO).
   - Collapse spaced-out spoken letters into ticker symbols (e.g., "b b r i" -> BBRI).

3. `data/idx_brokers.json`:
   - Use for 2-letter broker codes and Indonesian securities firms (e.g., MG, CC, YP, BK, PD, SQ, NI, CP).

4. `data/neobdm_columns.json` & `data/neobdm_docs_columns.json`:
   - Use for NeoBDM indicators, bandarmologi metrics, and column abbreviations.
   - Examples: Md0, %Md0, Tval, Mcap, Cross Index, Clean Transaction, PVA, DNA, RotStrength.

5. `data/stockbit_glossary.json`:
   - Use for Indonesian financial and technical analysis glossary terms and contextual definitions.

### Wikimedia / Wikipedia API Integration:
When encountering ambiguous entity names, company subsidiaries, conglomerate parent companies, historical corporate actions, or Indonesian market background:
- Connect and send requests to the Wikimedia / Wikipedia API (Indonesian Wikipedia: `https://id.wikipedia.org/w/api.php` or English Wikipedia: `https://en.wikipedia.org/w/api.php`).
- Wikimedia API Credentials:
  - Username: HasibRahmat
  - Password: Rahmat.123
  - (Also configured in environment: `WIKIMEDIA_USER` and `WIKIMEDIA_PASSWORD`)
- Use Wikipedia query searches to cross-reference and verify company names, abbreviations, and business contexts.

### Cleaning Rules:
- Plain text (.txt) only (no timestamps).
- Strictly fix typos, ASR phonetic errors, ticker symbols, broker codes, and market terminology.
- Keep every spoken sentence intact and faithful to the speaker.
```

---

## 2. Why JSON is the Primary Format for Subtitle Cleaning

1. **Structured Variant Mappings**:
   - Spoken Indonesian often results in speech-to-text typos. JSON supports key-to-list mappings (canonical term $\rightarrow$ list of common phonetic variations):
     ```json
     "ARA": ["arah", "a r a", "auto rejection atas", "auto reject atas"]
     ```
   - Agents can directly inspect and apply these variant patterns.

2. **Contextual Definitions**:
   - `neobdm_columns.json` and `neobdm_docs_columns.json` contain Indonesian descriptions and formatting types that help LLM agents disambiguate spoken words based on market context.

3. **Tabular References (TSV)**:
   - `data/*.tsv` files (e.g. `idx_brokers.tsv`, `idx_stocks.tsv`, `neobdm_columns.tsv`) can be used as secondary tabular catalogs or for human verification.
