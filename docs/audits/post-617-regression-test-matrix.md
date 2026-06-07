# Post-617 Regression Test Matrix

This matrix defines the expected behavior for various tender types and fixtures. It serves as a benchmark for regression testing the tender analysis and generation engine.

| Fixture Name | Tender Type | Expected Required Documents | Expected Blockers | Expected Allowed Outputs | Expected Forbidden Outputs | Expected Gate Result | Tested Module |
|--------------|-------------|-----------------------------|-------------------|--------------------------|----------------------------|----------------------|---------------|
| building-design.md | Tender | Tech Proposal, Financial Proposal, Inception Report | Missing lead architect | Concept Design | Unsigned proposal | PASS | lib/engine |
| road-design.md | Tender | Road Survey, Traffic Study | Missing P.E. license | Maintenance Plan | Direct pricing in tech | PASS | lib/engine |
| water-sanitation-tender.md | Tender | Tech Design, EIA Approval, H&S Plan | Missing EIA approval | Methodology Statement | Pricing in technical | FAIL (if EIA missing) | lib/engine |
| hospital-expansion.md | RFP | Construction Plan, Bio-med Plan, ISO Certs | Missing ISO 9001 | Timeline | Generic safety plan | FAIL (if ISO missing) | lib/engine |
| pharma-factory.md | Design-Build | Cleanroom Design, HVAC Protocol | No GMP experience | Validation Plan | Non-GMP materials | PASS | lib/engine |
| eoi-example.md | EOI | Company Profile, Project List | No relevant projects | Staff CVs | Detailed Pricing | PASS | lib/engine |
| rfq-example.md | RFQ | Quote, Delivery Timeline | Exceeds 14d delivery | Catalog | Substitution without notice | PASS | lib/engine |
| donor-proposal.md | Grant | Budget (USD), Logframe, Sustainability | No sustainability plan | Beneficiary list | Overhead > 15% | PASS | lib/engine |
| two-envelope-tender.md | Two-Envelope | Tech Design, Geotech, Traffic | Pricing in Tech Env | Site Layout | Price Schedule in Tech | FAIL (if price leak) | lib/engine |
| scanned-extraction.md | Scanned | Extractable Requirements | LOW_EXTRACT_CONFIDENCE | Manual Override | Automated Finalize | BLOCK | lib/extract-text |
| corrupted-extraction.md | Corrupted | N/A | EXTRACTION_FAILED | None | Any Generated Doc | BLOCK | lib/extract-text |

## Key Verification Points
- **Provider Order**: Verify Anthropic is always last.
- **Data Privacy**: Ensure `fileContent` and `extractedText` are not leaked in list views.
- **Safety Gates**: Verify that blockers correctly stop the generation workflow.
- **Two-Envelope Integrity**: Ensure no financial data leaks into technical outputs.
