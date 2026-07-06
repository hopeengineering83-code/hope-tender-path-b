#!/usr/bin/env python3
"""
Generate the 20-fixture Golden Tender Corpus.

Each fixture is a privacy-sanitized, fully-synthetic tender document with:
- Multi-page [Page N] markers so page-ledger + page attribution can be tested
- A clear Reference, Client, Deadline, Submission method
- A known set of mandatory requirements (so requirement extractor + classifier can be tested)
- A known procurement structure (single envelope / two-envelope / email / portal / physical)
- A known tender type (RFP / RFQ / EOI / ITB / RFT / prequalification / framework / consultancy / works / goods)

The corpus covers:
  1.  RFP — consulting services — email submission
  2.  RFQ — goods supply — physical submission
  3.  EOI — consultancy — email
  4.  REOI — consultancy — portal
  5.  ITB — works — sealed envelope physical
  6.  RFT — works — portal
  7.  Prequalification — multi-discipline — email
  8.  Framework agreement — engineering — portal
  9.  Mixed (technical+financial) — design — email
  10. Two-envelope — bridge — physical
  11. Single-envelope — building design — email
  12. Donor-funded (World Bank) — water sanitation — portal
  13. UN-funded (UNDP) — consultancy — email
  14. African Development Bank — roads — portal
  15. National government — health equipment supply — physical
  16. Local authority — urban planning — email
  17. Scanned / weak-OCR — agriculture supply — physical (intentionally low quality)
  18. Multi-file tender — infrastructure — email (master + annex references)
  19. Strict filename + order — defense equipment — sealed envelope
  20. International bid — hospital expansion — two-envelope email

The fixtures are deliberately synthetic — every name, reference number, deadline,
and email is fabricated. None of the procuring entities or contacts are real.
"""

import json
import os
from pathlib import Path

CORPUS_DIR = Path("tests/fixtures/golden-corpus")
CORPUS_DIR.mkdir(parents=True, exist_ok=True)

# ─── 20 fixture definitions ──────────────────────────────────────────────────

FIXTURES = [
    # 1. RFP — consulting — email
    {
        "id": "01-rfp-consulting-email",
        "name": "RFP — Consulting Services — Email Submission",
        "tenderType": "RFP",
        "procurementStructure": "email",
        "envelopeMode": "SINGLE_ENVELOPE",
        "submissionMethod": "email",
        "expected": {
            "reference": "MOU/RFP/2026/0001",
            "clientName": "Ministry of Urban Development",
            "deadline": "2026-11-30",
            "submissionMethod": "email",
            "submissionEmails": ["bids@moud.gov.et"],
            "submissionEmailSubject": "MOU/RFP/2026/0001",
        },
        "text": """[Page 1]
MINISTRY OF URBAN DEVELOPMENT
REQUEST FOR PROPOSAL
Reference: MOU/RFP/2026/0001
Procuring Entity: Ministry of Urban Development
Deadline: 30 November 2026
Submit by email to bids@moud.gov.et
The email subject must contain MOU/RFP/2026/0001.
Submission Method: Email

[Page 2]
SCOPE OF SERVICES
The selected firm shall provide consulting services for the City Master Plan Update.
Services include:
- Inception report
- Stakeholder consultation
- Draft master plan
- Final master plan with implementation roadmap

[Page 3]
MANDATORY REQUIREMENTS
1. The consultant must have at least 10 years of experience in urban planning.
2. The consultant must submit a registered business licence.
3. The consultant must nominate a team leader with a minimum of 15 years of experience.
4. The technical proposal must not exceed 30 pages.

EVALUATION CRITERIA
Technical approach: 40 points
Relevant experience: 30 points
Key personnel: 20 points
Work plan: 10 points
Total technical: 100 points
Financial proposal: evaluated separately only for technically qualified bidders.
"""
    },
    # 2. RFQ — goods supply — physical
    {
        "id": "02-rfq-goods-physical",
        "name": "RFQ — Office Equipment Supply — Physical Submission",
        "tenderType": "RFQ",
        "procurementStructure": "physical",
        "envelopeMode": "SINGLE_ENVELOPE",
        "submissionMethod": "physical",
        "expected": {
            "reference": "MOF/RFQ/2026/0002",
            "clientName": "Ministry of Finance",
            "deadline": "2026-10-15",
            "submissionMethod": "physical",
        },
        "text": """[Page 1]
MINISTRY OF FINANCE
REQUEST FOR QUOTATION
Reference: MOF/RFQ/2026/0002
Procuring Entity: Ministry of Finance
Deadline: 15 October 2026
Submit by hand or by courier in a sealed envelope to:
Ministry of Finance, Procurement Office, 4th Floor, Room 412
Submission Method: Physical

[Page 2]
SUPPLY ITEMS
- 200 desktop computers (minimum 8GB RAM, 256GB SSD)
- 50 monochrome laser printers (minimum 30 ppm)
- 100 UPS units (minimum 1.5 kVA)
- 5-year on-site warranty required for all items
- Delivery within 60 calendar days of contract signing

[Page 3]
MANDATORY REQUIREMENTS
1. The bidder must be a registered supplier with a valid tax clearance certificate.
2. The bidder must provide at least 3 references for similar supply contracts in the last 5 years.
3. Items must comply with ISO 9001 quality standards.
4. Bid security of 2% of the total bid value must be submitted with the bid.
"""
    },
    # 3. EOI — consultancy — email
    {
        "id": "03-eoi-consulting-email",
        "name": "EOI — Consulting Services — Email",
        "tenderType": "EOI",
        "procurementStructure": "email",
        "envelopeMode": "SINGLE_ENVELOPE",
        "submissionMethod": "email",
        "expected": {
            "reference": "AU/EOI/2026/0003",
            "clientName": "African Union",
            "deadline": "2026-12-20",
            "submissionMethod": "email",
        },
        "text": """[Page 1]
AFRICAN UNION
EXPRESSION OF INTEREST
Reference: AU/EOI/2026/0003
Procuring Entity: African Union Commission
Deadline: 20 December 2026
Submit by email to eoi@africa-union.org
Submission Method: Email

[Page 2]
The African Union invites expressions of interest from qualified consulting firms for
the Continental Trade Facilitation Study. Interested firms should submit:
- Company profile (max 10 pages)
- List of similar assignments completed in the last 7 years
- CVs of key personnel
- Audit reports for the last 3 years

[Page 3]
Shortlisted firms will be invited to submit a full technical and financial proposal
through a separate request process.
"""
    },
    # 4. REOI — consultancy — portal
    {
        "id": "04-reoi-consulting-portal",
        "name": "REOI — Consulting Services — Portal",
        "tenderType": "REOI",
        "procurementStructure": "portal",
        "envelopeMode": "SINGLE_ENVELOPE",
        "submissionMethod": "portal",
        "expected": {
            "reference": "NEA/REOI/2026/0004",
            "clientName": "National Environmental Authority",
            "deadline": "2027-01-10",
            "submissionMethod": "portal",
        },
        "text": """[Page 1]
NATIONAL ENVIRONMENTAL AUTHORITY
REQUEST FOR EXPRESSION OF INTEREST
Reference: NEA/REOI/2026/0004
Procuring Entity: National Environmental Authority
Deadline: 10 January 2027
Submit via the e-procurement portal at https://tenders.nea.gov.et
Submission Method: Portal

[Page 2]
The Authority requests expressions of interest for environmental audit services across
12 industrial facilities. Shortlisted firms will receive a detailed request for proposal document.

[Page 3]
ELIGIBILITY
- Registered firm with environmental audit licence
- Minimum 5 years of experience
- Lead auditor with ISO 14001 lead auditor certification
"""
    },
    # 5. ITB — works — sealed envelope physical
    {
        "id": "05-itb-works-physical",
        "name": "ITB — Civil Works — Sealed Envelope Physical",
        "tenderType": "ITB",
        "procurementStructure": "physical",
        "envelopeMode": "SINGLE_ENVELOPE",
        "submissionMethod": "physical",
        "expected": {
            "reference": "ERA/ITB/2026/0005",
            "clientName": "Ethiopian Roads Authority",
            "deadline": "2026-09-25",
            "submissionMethod": "physical",
        },
        "text": """[Page 1]
ETHIOPIAN ROADS AUTHORITY
INVITATION TO BID
Reference: ERA/ITB/2026/0005
Procuring Entity: Ethiopian Roads Authority
Deadline: 25 September 2026
Submit by hand in a sealed envelope to:
ERA Procurement Office, Churchill Avenue, Addis Ababa
Submission Method: Physical

[Page 2]
SCOPE OF WORKS
- 85 km road upgrading to Class B standard
- 3 major bridge crossings
- 12 culvert structures
- Drainage and erosion control

[Page 3]
BID SECURITY
Bid security of ETB 2,000,000 must be submitted with the bid.
Performance security of 10% of contract value required from the successful bidder.

[Page 4]
MANDATORY REQUIREMENTS
1. Bidder must have completed at least 2 road projects of similar size in the last 10 years.
2. Bidder must have a minimum average annual turnover of ETB 500,000,000 over the last 5 years.
3. Bidder must own key equipment (graders, pavers, rollers).
"""
    },
    # 6. RFT — works — portal
    {
        "id": "06-rft-works-portal",
        "name": "RFT — Construction Works — Portal",
        "tenderType": "RFT",
        "procurementStructure": "portal",
        "envelopeMode": "SINGLE_ENVELOPE",
        "submissionMethod": "portal",
        "expected": {
            "reference": "MOW/RFT/2026/0006",
            "clientName": "Ministry of Water and Energy",
            "deadline": "2026-12-05",
            "submissionMethod": "portal",
        },
        "text": """[Page 1]
MINISTRY OF WATER AND ENERGY
REQUEST FOR TENDER
Reference: MOW/RFT/2026/0006
Procuring Entity: Ministry of Water and Energy
Deadline: 5 December 2026
Submit via the e-tendering portal at https://etender.mowe.gov.et
Submission Method: Portal

[Page 2]
SCOPE OF WORKS
Construction of 5 rural water supply schemes including:
- 15 boreholes with hand pumps
- 3 mini water distribution systems
- 50 communal latrines
- Water quality testing laboratory equipment

[Page 3]
BID SECURITY: ETB 500,000
PERFORMANCE SECURITY: 10% of contract value
VALIDITY: 120 calendar days
"""
    },
    # 7. Prequalification — multidisciplinary — email
    {
        "id": "07-prequal-multidiscipline-email",
        "name": "Prequalification — Multidisciplinary Engineering — Email",
        "tenderType": "prequalification",
        "procurementStructure": "email",
        "envelopeMode": "SINGLE_ENVELOPE",
        "submissionMethod": "email",
        "expected": {
            "reference": "MOC/PQ/2026/0007",
            "clientName": "Ministry of Construction",
            "deadline": "2026-11-15",
            "submissionMethod": "email",
        },
        "text": """[Page 1]
MINISTRY OF CONSTRUCTION
PREQUALIFICATION OF CONTRACTORS
Reference: MOC/PQ/2026/0007
Procuring Entity: Ministry of Construction
Deadline: 15 November 2026
Submit by email to pq@moc.gov.et
Submission Method: Email

[Page 2]
The Ministry invites applications for prequalification of multidisciplinary engineering
firms for the National Infrastructure Programme 2027-2029. Prequalified firms will be
invited to bid on multiple packages under framework agreements.

[Page 3]
ELIGIBILITY
- Minimum 10 years of multidisciplinary engineering experience
- Average annual turnover of ETB 200,000,000 over the last 5 years
- Lead engineers must hold relevant professional registrations
- ISO 9001 certified quality management system
"""
    },
    # 8. Framework agreement — engineering — portal
    {
        "id": "08-framework-engineering-portal",
        "name": "Framework Agreement — Engineering Services — Portal",
        "tenderType": "framework",
        "procurementStructure": "portal",
        "envelopeMode": "SINGLE_ENVELOPE",
        "submissionMethod": "portal",
        "expected": {
            "reference": "NUDA/FA/2026/0008",
            "clientName": "National Urban Development Agency",
            "deadline": "2027-02-28",
            "submissionMethod": "portal",
        },
        "text": """[Page 1]
NATIONAL URBAN DEVELOPMENT AGENCY
FRAMEWORK AGREEMENT
Reference: NUDA/FA/2026/0008
Procuring Entity: National Urban Development Agency
Deadline: 28 February 2027
Submit via the e-procurement portal at https://procurement.nuda.gov.et
Submission Method: Portal

[Page 2]
The Agency intends to establish a framework agreement with up to 5 qualified firms
for engineering consultancy services over a 3-year period.

[Page 3]
SERVICES COVERED
- Architectural design
- Structural engineering
- MEP design
- Construction supervision
- Feasibility studies
- Environmental impact assessment
"""
    },
    # 9. Mixed technical+financial — email
    {
        "id": "09-mixed-technical-financial-email",
        "name": "Mixed Technical + Financial — Email",
        "tenderType": "RFP",
        "procurementStructure": "technical-financial",
        "envelopeMode": "SINGLE_ENVELOPE",
        "submissionMethod": "email",
        "expected": {
            "reference": "MOH/RFP/2026/0009",
            "clientName": "Ministry of Health",
            "deadline": "2026-10-30",
            "submissionMethod": "email",
        },
        "text": """[Page 1]
MINISTRY OF HEALTH
REQUEST FOR PROPOSAL
Reference: MOH/RFP/2026/0009
Procuring Entity: Ministry of Health
Deadline: 30 October 2026
Submit by email to bids@moh.gov.et
Submission Method: Email

[Page 2]
The technical proposal and financial proposal must be submitted together in one
envelope (single-envelope submission). Technical and financial proposals are evaluated
together as a single combined score.

[Page 3]
EVALUATION
Technical: 70% weight
Financial: 30% weight
"""
    },
    # 10. Two-envelope — bridge — physical
    {
        "id": "10-two-envelope-bridge-physical",
        "name": "Two-Envelope — Bridge Construction — Physical",
        "tenderType": "ITB",
        "procurementStructure": "separate-envelopes",
        "envelopeMode": "TWO_ENVELOPE",
        "submissionMethod": "physical",
        "expected": {
            "reference": "RBA/ITB/2026/0010",
            "clientName": "Regional Bridge Authority",
            "deadline": "2026-11-20",
            "submissionMethod": "physical",
        },
        "text": """[Page 1]
REGIONAL BRIDGE AUTHORITY
INVITATION TO BID
Reference: RBA/ITB/2026/0010
Procuring Entity: Regional Bridge Authority
Deadline: 20 November 2026
Submit by hand in two separate sealed envelopes to:
RBA Procurement Office, Bridge House, 1st Floor
Submission Method: Physical

[Page 2]
ENVELOPE A: TECHNICAL PROPOSAL
- Bridge engineering design
- Geotechnical survey report
- Traffic management plan
- CVs of key personnel

[Page 3]
ENVELOPE B: FINANCIAL PROPOSAL
- Bill of Quantities (BOQ)
- Price schedule
- Bid security

[Page 4]
The technical envelope must NOT contain any pricing information.
Technical proposals will be evaluated first. Only technically qualified bidders
will have their financial envelopes opened.
"""
    },
    # 11. Single-envelope — building design — email
    {
        "id": "11-single-envelope-building-email",
        "name": "Single-Envelope — Building Design — Email",
        "tenderType": "RFP",
        "procurementStructure": "single-envelope",
        "envelopeMode": "SINGLE_ENVELOPE",
        "submissionMethod": "email",
        "expected": {
            "reference": "DCO/RFP/2026/0011",
            "clientName": "Development Cooperation Office",
            "deadline": "2026-12-10",
            "submissionMethod": "email",
        },
        "text": """[Page 1]
DEVELOPMENT COOPERATION OFFICE
REQUEST FOR PROPOSAL
Reference: DCO/RFP/2026/0011
Procuring Entity: Development Cooperation Office
Deadline: 10 December 2026
Submit by email to tenders@dco.gov.et
Submission Method: Email

[Page 2]
SCOPE
Architectural and engineering design for a 6-storey commercial office building with
- 3 basement parking levels
- 12,000 sqm gross floor area
- LEED Gold certification target

[Page 3]
SUBMISSION
Single-envelope submission: technical and financial proposals combined in one
envelope (single-envelope mode). Both are evaluated together.
"""
    },
    # 12. Donor-funded World Bank — water sanitation — portal
    {
        "id": "12-wb-water-sanitation-portal",
        "name": "World Bank Funded — Water Sanitation — Portal",
        "tenderType": "RFP",
        "procurementStructure": "portal",
        "envelopeMode": "SINGLE_ENVELOPE",
        "submissionMethod": "portal",
        "expected": {
            "reference": "WB-WSH/RFP/2026/0012",
            "clientName": "World Bank",
            "deadline": "2027-01-20",
            "submissionMethod": "portal",
        },
        "text": """[Page 1]
THE WORLD BANK
REQUEST FOR PROPOSAL
Reference: WB-WSH/RFP/2026/0012
Procuring Entity: World Bank — Ethiopia Country Office
Deadline: 20 January 2027
Submit via the e-procurement portal at https://wbprocurement.org
Submission Method: Portal

[Page 2]
SCOPE OF SERVICES
Consultancy services for the National Water Supply and Sanitation Programme including:
- Feasibility study for 12 towns
- Detailed engineering design
- Environmental and social impact assessment (ESIA)
- Construction supervision

[Page 3]
FUNDING
This consulting services is financed by the World Bank under the International
Development Association (IDA) credit. Eligibility is restricted to firms from
IDA-eligible member countries.
"""
    },
    # 13. UN-funded UNDP — consultancy — email
    {
        "id": "13-undp-consulting-email",
        "name": "UNDP Funded — Consulting Services — Email",
        "tenderType": "RFP",
        "procurementStructure": "email",
        "envelopeMode": "SINGLE_ENVELOPE",
        "submissionMethod": "email",
        "expected": {
            "reference": "UNDP/ETH/RFP/2026/0013",
            "clientName": "UNDP Ethiopia",
            "deadline": "2026-12-28",
            "submissionMethod": "email",
        },
        "text": """[Page 1]
UNITED NATIONS DEVELOPMENT PROGRAMME
REQUEST FOR PROPOSAL
Reference: UNDP/ETH/RFP/2026/0013
Procuring Entity: UNDP Ethiopia Country Office
Deadline: 28 December 2026
Submit by email to procurement.et@undp.org
Submission Method: Email

[Page 2]
SCOPE
Consultancy services for institutional capacity assessment of 24 federal agencies.
The assessment covers:
- Organizational structure review
- Business process mapping
- IT systems audit
- Capacity building recommendations

[Page 3]
INTERNATIONAL BIDDERS
International consulting firms may apply as lead or in joint venture with a local firm.
UNDP encourages joint ventures with national firms.
"""
    },
    # 14. African Development Bank — roads — portal
    {
        "id": "14-afdb-roads-portal",
        "name": "African Development Bank — Road Design — Portal",
        "tenderType": "RFP",
        "procurementStructure": "portal",
        "envelopeMode": "SINGLE_ENVELOPE",
        "submissionMethod": "portal",
        "expected": {
            "reference": "AfDB/ROADS/RFP/2026/0014",
            "clientName": "African Development Bank",
            "deadline": "2027-02-15",
            "submissionMethod": "portal",
        },
        "text": """[Page 1]
AFRICAN DEVELOPMENT BANK
REQUEST FOR PROPOSAL
Reference: AfDB/ROADS/RFP/2026/0014
Procuring Entity: African Development Bank
Deadline: 15 February 2027
Submit via the AfDB e-procurement portal at https://afdbprocurement.org
Submission Method: Portal

[Page 2]
SCOPE OF SERVICES
Detailed engineering design of the 220 km Mekelle-Dessie Road Upgrading Project
including:
- Pavement design
- 4 major bridge structures
- Drainage and erosion control
- Road safety audit
- Environmental and social impact assessment
"""
    },
    # 15. National government — health equipment supply — physical
    {
        "id": "15-moh-equipment-physical",
        "name": "Federal Ministry of Health — Medical Equipment Supply — Physical",
        "tenderType": "goods",
        "procurementStructure": "physical",
        "envelopeMode": "SINGLE_ENVELOPE",
        "submissionMethod": "physical",
        "expected": {
            "reference": "FMOH/GOODS/2026/0015",
            "clientName": "Federal Ministry of Health",
            "deadline": "2026-11-30",
            "submissionMethod": "physical",
        },
        "text": """[Page 1]
FEDERAL MINISTRY OF HEALTH
TENDER FOR MEDICAL EQUIPMENT SUPPLY
Reference: FMOH/GOODS/2026/0015
Procuring Entity: Federal Ministry of Health
Deadline: 30 November 2026
Submit by hand in a sealed envelope to:
FMOH Procurement Office, Africa Avenue, Addis Ababa
Submission Method: Physical

[Page 2]
SUPPLY ITEMS
- 50 ICU ventilators (adult/pediatric)
- 100 patient monitors (5-parameter)
- 25 anaesthesia machines
- 10 mobile X-ray units
- All items must be CE-marked and FDA-approved

[Page 3]
BID SECURITY: 2% of bid value
DELIVERY: 90 calendar days from contract signing
WARRANTY: 24 months minimum
INSTALLATION: Supplier must include installation and training
"""
    },
    # 16. Local authority — urban planning — email
    {
        "id": "16-aca-urban-planning-email",
        "name": "Addis City Authority — Urban Planning — Email",
        "tenderType": "RFP",
        "procurementStructure": "email",
        "envelopeMode": "SINGLE_ENVELOPE",
        "submissionMethod": "email",
        "expected": {
            "reference": "ACA/RFP/2026/0016",
            "clientName": "Addis City Authority",
            "deadline": "2026-10-15",
            "submissionMethod": "email",
        },
        "text": """[Page 1]
ADDIS CITY AUTHORITY
REQUEST FOR PROPOSAL
Reference: ACA/RFP/2026/0016
Procuring Entity: Addis City Authority
Deadline: 15 October 2026
Submit by email to planning@aca.gov.et
Submission Method: Email

[Page 2]
SCOPE
Comprehensive spatial planning for the Greater Addis Metropolitan Area including:
- Demographic projection to 2050
- Land use plan
- Transport network integration
- Housing strategy
- Green infrastructure plan
"""
    },
    # 17. Scanned / weak-OCR — agriculture supply — physical
    {
        "id": "17-scanned-agriculture-physical",
        "name": "Scanned / Weak OCR — Agriculture Supply — Physical",
        "tenderType": "goods",
        "procurementStructure": "physical",
        "envelopeMode": "SINGLE_ENVELOPE",
        "submissionMethod": "physical",
        "expected": {
            "reference": "MOA/GOODS/2026/0017",
            "clientName": "Ministry of Agriculture",
            "deadline": "2026-12-01",
            "submissionMethod": "physical",
        },
        "text": """[Page 1]
M i n i s t r y  o f  A g r i c u l t u r e
T e n d e r  N o t i c e :  F e r t i l i z e r  S u p p l y
R e f e r e n c e :  M O A / G O O D S / 2 0 2 6 / 0 0 1 7
D e a d l i n e :  0 1  D e c e m b e r  2 0 2 6
S u b m i t  b y  h a n d  i n  s e a l e d  e n v e l o p e
"""
    },
    # 18. Multi-file tender — infrastructure — email
    {
        "id": "18-multi-file-infrastructure-email",
        "name": "Multi-File Tender — Infrastructure Development — Email",
        "tenderType": "RFP",
        "procurementStructure": "email",
        "envelopeMode": "SINGLE_ENVELOPE",
        "submissionMethod": "email",
        "expected": {
            "reference": "WBG/INFRA/RFP/2026/0018",
            "clientName": "World Bank Group",
            "deadline": "2027-02-28",
            "submissionMethod": "email",
        },
        "text": """[Page 1]
THE WORLD BANK GROUP
TENDER FOR INFRASTRUCTURE DEVELOPMENT
Reference: WBG/INFRA/RFP/2026/0018
Procuring Entity: World Bank Group
Deadline: 28 February 2027
Submit by email to wb-tenders@worldbankgroup.org
Submission Method: Email

[Page 2]
This tender comprises multiple files:
- Main RFP document (this file)
- Technical Specifications Annex (separate file)
- Financial Proposal Format Annex (separate file)
- Form of Bid (separate file)
- General Conditions of Contract (separate file)

[Page 3]
Bidders must submit all required documents in a single email. Incomplete submissions
will be rejected. The email subject must reference WBG/INFRA/RFP/2026/0018.
"""
    },
    # 19. Strict filename + order — defense equipment — sealed envelope
    {
        "id": "19-strict-filename-order-defense",
        "name": "Strict Filename + Order — Defense Equipment — Sealed Envelope",
        "tenderType": "ITB",
        "procurementStructure": "physical",
        "envelopeMode": "SINGLE_ENVELOPE",
        "submissionMethod": "physical",
        "expected": {
            "reference": "MOD/ITB/2026/0019",
            "clientName": "Ministry of Defense",
            "deadline": "2026-12-15",
            "submissionMethod": "physical",
        },
        "text": """[Page 1]
MINISTRY OF DEFENSE
INVITATION TO BID
Reference: MOD/ITB/2026/0019
Procuring Entity: Ministry of Defense
Deadline: 15 December 2026
Submit by hand in a sealed envelope to:
MOD Procurement Office, Defense Headquarters
Submission Method: Physical

[Page 2]
REQUIRED DOCUMENTS — STRICT FILENAME AND ORDER
Bidders must submit documents in this exact filename and order:
1. Technical Proposal.docx
2. Financial Proposal.docx
3. Company Profile.docx
4. Compliance Matrix.xlsx
5. Bid Security.pdf

[Page 3]
Documents not matching the exact filename and order will be rejected without
further evaluation. The filenames are case-sensitive.
"""
    },
    # 20. International bid — hospital expansion — two-envelope email
    {
        "id": "20-international-hospital-two-envelope-email",
        "name": "International Bid — Hospital Expansion — Two-Envelope Email",
        "tenderType": "RFP",
        "procurementStructure": "separate-envelopes",
        "envelopeMode": "TWO_ENVELOPE",
        "submissionMethod": "email",
        "expected": {
            "reference": "SJH/RFP/2026/0020",
            "clientName": "St. Jude Hospital",
            "deadline": "2027-01-31",
            "submissionMethod": "email",
        },
        "text": """[Page 1]
ST. JUDE HOSPITAL
REQUEST FOR PROPOSAL
Reference: SJH/RFP/2026/0020
Procuring Entity: St. Jude Hospital
Deadline: 31 January 2027
Submit by email to tenders@stjudehospital.org
Submission Method: Email

[Page 2]
ENVELOPE A: TECHNICAL PROPOSAL
- Inception report
- Construction plan
- Bio-medical integration plan
- ISO certificates (9001, 13485)
- CVs of key personnel

[Page 3]
ENVELOPE B: FINANCIAL PROPOSAL
- Bill of Quantities
- Price schedule
- Bid security

[Page 4]
Two-envelope submission required. Technical envelope must NOT contain any pricing
information. Technical proposals will be evaluated first; only technically
qualified bidders will have their financial envelopes opened.

[Page 5]
INTERNATIONAL BIDDERS
International bidders may apply directly or in joint venture with a local firm.
Bidders must comply with national procurement regulations.
"""
    },
]


def main():
    # Write each fixture as a .md file
    written = []
    for fixture in FIXTURES:
        path = CORPUS_DIR / f"{fixture['id']}.md"
        # Write the fixture with a metadata header
        header = f"""<!-- golden-corpus-fixture id="{fixture['id']}" name="{fixture['name']}" -->
<!-- tenderType: {fixture['tenderType']} | procurementStructure: {fixture['procurementStructure']} | envelopeMode: {fixture['envelopeMode']} | submissionMethod: {fixture['submissionMethod']} -->

"""
        path.write_text(header + fixture["text"])
        written.append({
            "id": fixture["id"],
            "name": fixture["name"],
            "file": str(path),
            "tenderType": fixture["tenderType"],
            "procurementStructure": fixture["procurementStructure"],
            "envelopeMode": fixture["envelopeMode"],
            "submissionMethod": fixture["submissionMethod"],
            "expected": fixture["expected"],
        })

    # Write the manifest
    manifest = {
        "$schema": "https://json-schema.org/draft-07/schema#",
        "$id": "https://hope-tender-path/golden-corpus.manifest.json",
        "title": "Golden Tender Corpus — 20 Sanitized Fixtures",
        "description": (
            "Privacy-safe, fully-synthetic tender documents covering 20 distinct scenarios. "
            "Each fixture has known reference, client, deadline, submission method, and "
            "expected extraction outcomes. Used by tests/golden-corpus-acceptance.test.ts "
            "to validate the universal tender intelligence modules (tender-classification, "
            "page-ledger, evidence-candidate, requirement-categories, draft-final-gate-separation) "
            "and the metadata extraction pipeline."
        ),
        "version": "1.0.0",
        "fixtureCount": len(FIXTURES),
        "fixtures": written,
        "coverage": {
            "tenderTypes": sorted(set(f["tenderType"] for f in FIXTURES)),
            "procurementStructures": sorted(set(f["procurementStructure"] for f in FIXTURES)),
            "envelopeModes": sorted(set(f["envelopeMode"] for f in FIXTURES)),
            "submissionMethods": sorted(set(f["submissionMethod"] for f in FIXTURES)),
        },
        "privacy": (
            "Every name, reference number, deadline, and email in this corpus is "
            "fabricated. No procuring entity or contact is real. The corpus is safe "
            "to commit to public repositories and to use in CI."
        ),
    }
    manifest_path = CORPUS_DIR / "manifest.json"
    manifest_path.write_text(json.dumps(manifest, indent=2))
    print(f"Wrote {len(FIXTURES)} fixtures to {CORPUS_DIR}")
    print(f"Manifest: {manifest_path}")


if __name__ == "__main__":
    main()
