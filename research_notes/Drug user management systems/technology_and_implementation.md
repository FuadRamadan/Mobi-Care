# Technology, Legal and Implementation Considerations for a National Digital Drug-User Case Management and Surveillance System in Sierra Leone (NDLEA + MoHS), as of late October 2026

Research method note: about 18 web searches/fetches, done 29 Oct 2026. Two primary-document hosts (passengerdataexplained.org and dpo-india.com, which hosts the Data Protection Bill 2025 PDF) were blocked by the session's network allowlist and could not be read directly. Claims taken from search-result summaries of those pages are marked as such.

## 1. Existing digital health infrastructure in Sierra Leone

### Takeaway
DHIS2 is the backbone of Sierra Leone's national HMIS and IDSR surveillance. CommCare has been used for community health worker (CHW) programmes, and the national ID number (NIN) covers most of the population. Internet use is low (about 21%), mobile SIM penetration is about 100%, and grid electricity is weak and concentrated in Freetown. Any system therefore has to work offline-first, run on low power, and offer SMS/USSD for people without data.

### Cited Findings
**Digital health strategy and DHIS2**
- Sierra Leone had a National Digital Health Strategy for 2018–2023, launched after a 2017 eHealth coordination hub was set up. Its goal was that "by 2023 an effective and efficient ICT enabled system supports delivery of quality, accessible, affordable, equitable, and timely healthcare services." — [MoHS National Digital Health Strategy 2018 (PDF)](https://mohs2017.wordpress.com/wp-content/uploads/2019/02/sl-national-digital-health-strategy-nov-2018.pdf)
- ICTworks lists a successor **National Digital Health Roadmap 2024–2026**, validated December 2023, and describes the 2018–2023 strategy as poorly executed. Only this one secondary source was found; the official roadmap was not located. — [ICTworks: Every African Country's NDHS in 2026](https://www.ictworks.org/updated-every-african-countrys-national-digital-health-strategy-in-2026/)
- An Oct 2024 health data ecosystem mapping (BMZ/DIPC) noted that implementation lagged because there was no roadmap to put the earlier strategy into operation. — [BMZ Digital: Sierra Leone Health Data Ecosystem Mapping (PDF)](https://www.bmz-digital.global/wp-content/uploads/2024/10/SIERRA-LEONE-Health-Data-Ecosystem-Mapping-DIPC.pdf)
- The national systems are: DHIS2 for routine HMIS and disease surveillance, iHRIS for human resources, eChannel for logistics, and a hybrid laboratory information system. Facility reports go through district DHIS2 to MoHS central level. — [ResearchGate: Digital Health Solutions and State of Interoperability: Landscape Analysis of Sierra Leone](https://www.researchgate.net/publication/359851552_Digital_Health_Solutions_and_State_of_Interoperability_Landscape_Analysis_of_Sierra_Leone)
- With CDC support, Sierra Leone built an electronic Integrated Disease Surveillance and Response (eIDSR) system on DHIS2. Maternal death reporting moved from Excel to case-based surveillance on DHIS2. — [ResearchGate: Digitalizing disease surveillance: experience from Sierra Leone](https://www.researchgate.net/publication/381000909_Digitalizing_disease_surveillance_experience_from_Sierra_Leone)
- The 2018 strategy itself states that DHIS2 (as then deployed, i.e. aggregate) "cannot be used as electronic medical records system." Most facilities in the landscape analysis ran only DHIS2 for aggregate reporting, or about two applications. — [MoHS NDHS 2018](https://mohs2017.wordpress.com/wp-content/uploads/2019/02/sl-national-digital-health-strategy-nov-2018.pdf); [ResearchGate landscape analysis](https://www.researchgate.net/publication/359851552_Digital_Health_Solutions_and_State_of_Interoperability_Landscape_Analysis_of_Sierra_Leone)
- Reported surveillance problems: underreporting, inconsistent case definitions, limited digital infrastructure and weak feedback loops. — [ResearchGate: Digitalizing disease surveillance](https://www.researchgate.net/publication/381000909_Digitalizing_disease_surveillance_experience_from_Sierra_Leone)

**CommCare / other tools**
- World Vision's AIM Health Plus (funded by Irish Aid) gave CHWs in Bonthe district smartphones with a CommCare app from 2018. The app handled timed and targeted counselling reminders and synced data to the cloud and the District Health Management Team. 323 users reached 54,177 beneficiaries between Oct 2020 and Sep 2021. The programme closed in Dec 2022. — [World Vision 2021 Digital Health Factsheet: AIM Health Plus](https://www.wvi.org/publications/health/2021-digital-health-factsheet-aim-health-plus-sierra-leone)
- Dimagi (CommCare) worked with the Directorate of Science, Technology and Innovation (DSTI) and MoHS on COVID-19 digital tools meant to scale nationally. — [Dimagi blog: COVID-19 Africa CommCare](https://commcare.dimagi.com/blog/covid-19-africa-commcare/)
- A Digital Square brief (June 2021) mapped 44 digital tools in Sierra Leone's pandemic response, 22 of them scaled nationally. World Vision's IVR-based Mobile Training System was handed to government at the MoHS eHealth Coordination Hub's request. — [Digital Square: MM brief Sierra Leone (PDF)](https://digitalsquare.org/s/MM-brief-Sierra-Leone.pdf)

**National ID (NCRA / NIN)**
- In 2019 the NIN was described as a "unique nationally recognised identifier... non-duplicating and non-reusable", launched as a blockchain-based system with UN/Kiva partners. — [State House Sierra Leone](https://statehouse.gov.sl/sierra-leone-gets-africas-first-blockchain-national-digital-identity-system)
- According to the World Bank, 6.4 million people have a NIN against a target of all 8.8 million citizens. Fewer than 500,000 ID cards had been issued by 2024 because the US$6–7 card fee is unaffordable for most people. — [World Bank blog: Unlocking opportunity: how digital ID can transform lives in Sierra Leone](https://blogs.worldbank.org/en/africacan/unlocking-opportunity-how-digital-id-can-transform-lives-in-sierra-leone)
- In Jan 2023 MOSIP signed an MoU with NCRA to pilot a modernised digital ID. — [MOSIP news](https://www.mosip.io/news_events/mosip-and-sierra-leone-sign-mou-to-pilot-national-digital-id-system); [Biometric Update](https://www.biometricupdate.com/202301/sierra-leone-signs-up-for-national-digital-id-pilot-built-with-mosip)

**Mobile / internet penetration**
- DataReportal Digital 2026 (end-2025 data): 8.94 million cellular connections (about 101% of population) and 1.85 million internet users (20.8%). Digital 2025 (early 2025): 8.66 million connections (99.2%), 1.80 million internet users (20.7%), 1.15 million social media identities (13.2%). DataReportal notes that some connections are voice/SMS only. — [DataReportal Digital 2026: Sierra Leone](https://datareportal.com/reports/digital-2026-sierra-leone); [Digital 2025: Sierra Leone](https://datareportal.com/reports/digital-2025-sierra-leone)
- Digital 2024 reported 2.70 million internet users (30.4%), higher than in 2025. This is probably a methodology revision rather than a real decline. — [DataReportal Digital 2024: Sierra Leone](https://datareportal.com/reports/digital-2024-sierra-leone)
- Africell says it has "60%+" market share and 4–5 million+ subscribers. This is a self-reported marketing figure and does not say whether it covers telecom or mobile money. — [Africell Sierra Leone](https://www.africell.com/en/markets/sierra-leone)
- The main mobile money operators are Orange Money and Africell's Afrimoney. USSD lets feature-phone users transact without internet; Afrimoney registers via *161#. — [Borgen Project](https://borgenproject.org/?p=568283); [Africell Sierra Leone](https://www.africell.com/en/markets/sierra-leone)

**Electricity**
- World Bank Multi-Tier Framework: 21.1% of households have grid or mini-grid access (20.5% grid, 0.6% mini-grid) and 14.7% have off-grid access. — [World Bank Open Knowledge MTF diagnostic](https://openknowledge.worldbank.org/entities/publication/373c197d-da90-463c-ac38-f824c50b6557)
- Afrobarometer (Apr 2024): 31% report an EDSA connection, but only 11% say power works "most" or "all of the time." — [Afrobarometer news release (PDF)](https://afrobarometer.org/wp-content/uploads/2024/05/News-release-Sierra-Leoneans-call-out-governments-performance-on-electricity-Afrobarometer-ma-bh-fmh-29apr24.pdf)
- About 90% of the 172,000 registered electricity customers are in Freetown. The grid depends on a single 161kV line from Bumbuna, and daily outages last up to 18 hours. — [US Trade.gov Country Commercial Guide: Energy](https://trade.gov/country-commercial-guides/sierra-leone-energy-infrastructure)
- Estimates of electricity access range from 16% to 36% depending on definition (SEforALL/UNOPS gives 36% grid-connected and 6% rural). — [Energy Institute New Energy World](https://knowledge.energyinst.org/new-energy-world/article?id=160427)

### Inferences
- DHIS2 is the natural home for the MoHS side: there is existing capacity, HMIS and eIDSR integration, and an active national instance. The 2018 strategy's "not an EMR" caveat refers to aggregate DHIS2. Tracker can handle longitudinal case management but is not a full clinical EMR.
- About 79% of people are not internet users, so drug users (often poor, young, unstable housing) are reachable mainly by voice, SMS and USSD. Self-referral and hotline channels should therefore be USSD/SMS/IVR first, with WhatsApp secondary.
- Facility and outreach devices need solar charging or power banks. Offline sync (DHIS2 Android Capture, CommCare, ODK) is essential outside Freetown and helpful even inside it, given outages of up to 18 hours.
- Because about 6.4 million people have a NIN, it could serve as an optional deduplication key. Card uptake is very low, so the system cannot depend on people showing cards, and for stigma and safety reasons the NIN should never be the visible identifier (see section 4).

### Gaps
- The official MoHS National Digital Health Roadmap 2024–2026 was not retrieved, so its content (interoperability layer, health ID, hosting policy) is unverified.
- No current figures were found for DHIS2 version, hosting location (MoHS server vs HISP/cloud), or Tracker programmes already in use in Sierra Leone.
- No evidence was found of OpenMRS or OpenSRP national deployments in Sierra Leone. The Digital Health Atlas was not checked directly.
- No GSMA Mobile Economy West Africa 2025/2026 figures for Sierra Leone (mobile internet coverage vs usage gap, 4G coverage) were retrieved.
- No independent 2025 mobile money adoption or market share figures (Bank of Sierra Leone/UNCDF DFS report) were retrieved.

## 2. Legal framework (status as of Oct 2026)

### Takeaway
Sierra Leone has **no enacted data protection law** as of late Oct 2026. A Data Protection and Right to Access Information Bill (2025) has been validated and reportedly approved by Cabinet, but was not found to be passed. The Cyber Security and Crime Act 2021 is in force. The National Drugs Control Act 2008 (amended 2017) is still the drug statute, and a Dec 2025 Chief Justice practice directive made sentencing much more punitive. **The "Mental Health Act 2023" could not be verified**: every source found says the 1902 Lunacy Act still applies and a Mental Health Bill is pending.

### Cited Findings
**Data protection**
- The Data Protection and Right to Access Information Bill 2025 exists as a draft (PDF hosted by a third party; not readable from this session). — [Bill PDF via dpo-india.com](https://www.dpo-india.com/Resources/privacy_laws_in_africa_nations/Sierra-Leone'Data-Protection-Right-Access-Information-Bill,2025.pdf)
- Search summary of a secondary source (not directly verifiable): the Ministry of Information and Civic Education validated the bill on 7 Nov 2025. Cabinet approved a National Data Protection Policy on 21 April 2026 and authorised the Act, which was still to be tabled in Parliament, and no record of enactment was found as of 21 Oct 2026. The planned law would convert the existing Right to Access Information Commission into a body with investigative and enforcement powers over public and private data handling. — [passengerdataexplained.org/sierra-leone](https://passengerdataexplained.org/sierra-leone/) (could not be fetched; treat as unconfirmed)
- Older sources also report no data protection law. — [dataprotection.africa Sierra Leone fact sheet](https://dataprotection.africa/sierra-leone/); [OGP Data Protection in Africa 2021 (PDF)](https://www.opengovpartnership.org/wp-content/uploads/2021/08/OGP-Data-Protection-Report.pdf)
- The Sierra Leone Data Strategy (MoCTI, Dec 2024) explicitly introduces no new regulation and aligns with existing laws, including the Cyber Security and Crime Act 2021. — [MoCTI Sierra Leone Data Strategy (PDF)](https://mocti.gov.sl/wp-content/uploads/2024/12/Sierra-Leone-Data-Strategy.pdf)

**Cyber Security and Crime Act 2021**
- Parliament passed it on 23 June 2021 and it was enacted in Nov 2021. It provides for data security protection, protection of critical national information infrastructure and privacy rights, and is modelled on the Budapest Convention. — [Parliament press release (PDF)](https://www.parliament.gov.sl/uploads/press_release/pdf/PARLIAMENT%20FINALLY%20ENACTS%20THE%20CYBER%20SECURITY%20AND%20CRIME%20ACT%202021%20INTO%20LAW-23rd%20June,%202021.pdf); [Council of Europe Octopus](https://coe.int/en/web/octopus/-/sierra-leone); [Act text, MoCTI (PDF)](https://mocti.gov.sl/wp-content/uploads/2024/09/Cyber-Crime-Act-2021.pdf)
- Part VI creates offences for unauthorised access, interception and data interference (examples given as ss.33–36, per a third-party summary). No provision specific to health data was found. — [law.ungovr.org Sierra Leone](https://law.ungovr.org/ai/sl)

**Drug law**
- The National Drugs Control Act 2008 created the National Drug Law Enforcement Agency (NDLEA). — [SierraLII article (Refell, 2024)](https://sierralii.gov.sl/articles/2024-03-18/Refell/should-the-government-declare-a-state-of-public-emergency-to-end-the-kush-epidemic)
- A secondary source says the Act was amended by the National Drugs Control (Amendment) Act 2017. — [cannabisregulations.ai](https://www.cannabisregulations.ai/country-legality/sierra-leone-marijuana)
- President Bio declared drug abuse (kush) a national emergency in April 2024. This was an executive declaration, not a statute. — [VOA Africa](https://www.voaafrica.com/a/sierra-leone-destroys-200-000-worth-of-narcotics-used-to-manufacture-kush/7578802.html); [NPR/KUNR](https://www.kunr.org/world-headlines/2024-02-10/cheap-plentiful-and-devastating-the-synthetic-drug-kush-is-walloping-sierra-leone)
- On 1 Dec 2025 the Chief Justice issued a practice directive: all drug cases under ss.7(a)–(c) of the 2008 Act are to be tried in the High Court, with no bail and a minimum 30-year sentence. — [TalkingDrugs](https://www.talkingdrugs.org/30-year-minimum-sierra-leone-new-drug-laws-are-some-of-the-worlds-toughest/)
- No 2024–2026 amendment to the National Drugs Control Act was found. Civil society has called for review of the 2008 Act. — [search summary; TalkingDrugs](https://www.talkingdrugs.org/30-year-minimum-sierra-leone-new-drug-laws-are-some-of-the-worlds-toughest/)
- A 2024 report put the NDLEA's total budget at barely about US$50,000, and a 2025 commentary described the agency as chronically underfunded. — [Pan African Visions, Jul 2025](https://panafricanvisions.com/2025/07/sierra-leones-dilemma-the-deadly-kush-continues-to-ravage-its-citizens/)

**Mental health law**
- MoHS says a Mental Health Bill is "completed and ready to be tabled in parliament" (undated). — [MoHS](https://mohs.gov.sl/moh-on-the-right-path-to-fighting-mental-health-problems-in-sierra-leone/)
- About a year ago (c. late 2025) The Times Sierra Leone described a new Mental Health Bill to replace the 1902 Lunacy Act as "currently before Parliament." — [The Times Sierra Leone](https://thetimes-sierraleone.com/health-ministry-partners-commit-to-improve-mental-health-access/)
- The 1902 Lunacy Act (Cap. 157) is still cited as the governing law, and WHO is supporting its replacement. — [Lunacy Act Cap 157 (PDF)](https://www.sierra-leone.org/Laws/Cap%20157.pdf); [Global Health Unfiltered](https://www.globalhealthunfiltered.com/blog/from-lunacy-to-mental-health-hunger-and-mental-health-in-sierra-leone); [WHO AFRO](https://www.afro.who.int/news/improving-access-mental-health-services-sierra-leone)

### Inferences
- **The brief's premise of a "Mental Health Act 2023" looks wrong**, unless it passed very recently and is not indexed. The report writer should flag this and recommend checking with MoHS and the Parliament Clerk.
- Without a data protection act there is no statutory regulator, sensitive-data category, or breach notification duty. The system therefore needs its own legal basis: a statutory instrument, MoU, or ministerial regulation under the Drugs Control Act and Public Health Act, plus a data-sharing agreement between NDLEA and MoHS. It should be designed now to meet the likely DP Act standards (e.g. ECOWAS Supplementary Act on Personal Data, Malabo Convention, GDPR-style principles) so it does not need retrofitting.
- The Dec 2025 directive (30-year minimums, no bail) **sharply raises the harm if health or treatment data reaches law enforcement**. If people fear that registering for treatment exposes them to prosecution, they will avoid services and the surveillance data will be biased. This is the strongest argument for a firewall between NDLEA enforcement records and MoHS clinical records (section 4).
- Cyber Security and Crime Act offences (unauthorised access and interception) give a legal hook for punishing insider misuse. Access policies should cite them.

### Gaps
- The text of the Data Protection Bill 2025 could not be read (host blocked), so its provisions on sensitive/health data, law enforcement exemptions, localisation and penalties are unknown.
- The Cabinet approval of 21 April 2026 is from one unverified secondary source.
- The National Drugs Control Act 2008 text was not reviewed for confidentiality or registry provisions. It is unknown whether it authorises a drug-user register or compulsory treatment.
- Whether the Public Health Act (2022) or any MoHS confidentiality regulations cover substance use treatment records was not checked.

## 3. Suitable platforms and LMIC precedents

### Takeaway
DHIS2 Tracker (with the Android Capture app) is the best fit for the national MoHS case management and surveillance layer, because it is already the national standard and supports offline use, SMS and fine-grained sharing. Existing DHIS2 surveillance trackers (HIV, TB) are explicitly not clinical care tools, so a care-oriented treatment and case management design has to be built, using the HIV case management package as a template. No published DHIS2 substance-use tracker was found.

### Cited Findings
- DHIS2's NCD materials list mental health as an emerging use case for Tracker enrolment and longitudinal follow-up. — [DHIS2 for NCDs](https://dhis2.org/ncd/)
- The FHI360 standardised DHIS2 Tracker package for HIV supports case management of individuals: visit scheduling and tracking missed appointments. This is the closest template for a drug treatment programme. — [FHI360 DHIS2 Tracker HIV metadata brief (PDF)](https://www.fhi360.org/sites/default/files/media/documents/resource-dhis2-tracker-metadata-package-brief.pdf)
- The DHIS2 HIV case surveillance tracker "is not optimised to support clinical case management or decision support." The TB tracker is "not designed to support clinical management nor patient care." — [DHIS2 HIV case surveillance tracker docs](https://docs.dhis2.org/en/implement/health/hiv/hiv-case-surveillance/design/hiv-case-surveillance-tracker.html); [DHIS2 TB case surveillance design](https://docs.dhis2.org/en/implement/health/tuberculosis/tb-case-surveillance/design.html)
- DHIS2 Android supports SMS-based reporting when there is no data connection. — [DHIS2 docs: SMS for reporting](https://docs.dhis2.org/en/implement/android-implementation/sms-for-reporting.html)
- CommCare has a Sierra Leone track record for offline CHW case management (AIM Health Plus). — [World Vision factsheet](https://www.wvi.org/publications/health/2021-digital-health-factsheet-aim-health-plus-sierra-leone)
- Evidence that case management helps: an observational study (n=30) of intensive case management for severe mental and substance use disorders found improved adherence, clinical status, social functioning and lower substance use. The evidence is preliminary. — [PMC5445418](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC5445418/)
- DHIS2 was used for disease surveillance in Guinea (2015–2020), a regional precedent for post-Ebola scale-up. — [PMC8811041](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC8811041/)

### Inferences (platform comparison, analyst judgement)
- **DHIS2 Tracker + Android Capture**: national standard; offline; SMS fallback; sharing and ownership model; break-the-glass; built-in analytics and maps; strong local HISP capacity. Weaknesses: not an EMR, and the UX for complex clinical notes is limited. **Recommended core** for MoHS treatment and case management and for surveillance.
- **OpenMRS**: better for facility-based clinical records (e.g. a detox ward at the Kissy Psychiatric Hospital) but has no Sierra Leone footprint found. Consider only for inpatient units, interoperating with DHIS2 via FHIR.
- **CommCare**: excellent offline outreach and peer worker workflows with a local precedent, but it is a SaaS licence cost and usually cloud hosted (sovereignty concern). Suitable if outreach UX matters more than DHIS2 integration.
- **OpenSRP**: FHIR-native and offline, but no Sierra Leone deployment was found.
- **KoboToolbox/ODK**: good for one-off surveys (prevalence, respondent-driven sampling, KAP), weak for longitudinal case management. Use for periodic surveys only.
- **Custom build**: the highest risk for sustainability and security (see section 6). Avoid it except for thin layers such as a USSD/IVR gateway, a pseudonymisation service, or an NDLEA seizure module.
- **USSD/SMS/IVR hotline** through both Orange and Africell (toll-free short code) for self-referral, anonymous help-seeking and appointment reminders. A WhatsApp chatbot can be a secondary channel for roughly the 13% on social media. Do not send personal data over WhatsApp.

### Gaps
- No published LMIC example was found of DHIS2, CommCare or OpenMRS used specifically for substance use treatment case management. The report writer should note that this would be novel.
- Costs of a DHIS2 implementation versus a CommCare licence for Sierra Leone were not retrieved.

## 4. Security design for highly sensitive data

### Takeaway
DHIS2 already provides granular sharing, audit logs, break-the-glass with a logged reason, and forced local database encryption on Android. These are needed but not enough. Given the 30-year minimum-sentencing regime and the absence of a DP law, the architecture should keep **two logically and organisationally separate systems**: an MoHS health/case management system holding identifiable data, and an NDLEA enforcement/supply system. They should share only aggregate or pseudonymised data under a written protocol.

### Cited Findings
- DHIS2 supports granular sharing of metadata and associated data, with read and write rights restricted to named users and groups. — [DHIS2 Security](https://dhis2.org/security)
- DHIS2 logs sensitive operations to an audit log. For Tracker, users can "break the glass" to see records outside their scope only after entering a reason, which is logged. — [DHIS2 Security](https://dhis2.org/security)
- An administrator can use the Android Settings App to force local database encryption on all DHIS2 Android apps. — [DHIS2 Security](https://dhis2.org/security). A 2015 thread said encryption was not supported at that time; this is outdated. — [dhis2-users archive](https://lists.launchpad.net/dhis2-users/msg08600.html); [DHIS2 community thread](https://community.dhis2.org/t/encryption-at-rest-for-tracked-entities-on-mobile/3049)
- The Cyber Security and Crime Act 2021 criminalises unauthorised access, interception and interference with data. — [Act text](https://mocti.gov.sl/wp-content/uploads/2024/09/Cyber-Crime-Act-2021.pdf)

### Inferences (recommended design, analyst judgement)
- **Separation**: MoHS owns client-level health and treatment data. NDLEA gets dashboards with aggregate counts (minimum cell size, e.g. suppress fewer than 5), hotspot maps at chiefdom/ward level, and substance trends. NDLEA should have no client-level read access, and a written rule should say treatment records are not admissible or usable for investigations. A court-order route, if any, should be narrow and audited.
- **Identifier**: generate a pseudonymous UIC on the device (e.g. a hash of initials, birth year, sex and district plus a salt held only by MoHS) for deduplication across facilities without names. Store the NIN, phone and name optionally in a separate, encrypted identity vault that only the treating clinician's org unit can access. Never print the NIN or UIC on referral slips.
- **RBAC**: roles for outreach/peer worker (capture only, own caseload), clinician (full record, own facility), district M&E (aggregate only), national MoHS analyst (de-identified line list), NDLEA analyst (aggregate only) and sysadmin (no data browsing; break-glass audited). Use DHIS2 tracker ownership with "protected" programme access.
- **Audit**: monthly review of audit logs, break-glass reports sent to an independent data protection officer at MoHS, and sanctions that cite the Cyber Security and Crime Act.
- **Encryption**: TLS everywhere; database and disk encryption at rest; forced Android DB encryption; device PIN; remote wipe through MDM; automatic logout. Back up off-site with encryption.
- **Hosting**: favour in-country government hosting (MoHS/national data centre) for sovereignty, with an encrypted off-site backup. A regional cloud is acceptable only under a contract that bars foreign law enforcement access and with keys held by government. Resolve the choice through the DP Bill's localisation rules, which are currently unknown.
- **Consent**: tiered informed consent (treatment, follow-up contact, data use for surveillance). Anonymous or unregistered service must remain possible; declining registration must never block treatment. Give clear verbal scripts in Krio.

### Gaps
- Whether Sierra Leone has a functioning government Tier-III data centre, and current MoHS DHIS2 hosting arrangements, were not found.
- The DP Bill's rules on localisation and cross-border transfer are unknown.

## 5. Analytics: dashboards, hotspot mapping, early warning, lab integration

### Takeaway
Kush is the leading substance in Sierra Leone treatment, and testing shows a changing mix of nitazenes and synthetic cannabinoids. A static registry would miss these shifts, so the system needs an early warning module that links drug checking and forensic lab results, overdose and death reports, and treatment trends. It should also feed the regional ECOWAS/UNODC WENDU reporting.

### Cited Findings
- UNODC World Drug Report 2025: kush accounts for the largest number of people in drug-use-disorder treatment in Sierra Leone. It emerged in 2022 and spread to Liberia, The Gambia, Guinea, Guinea-Bissau and Senegal. — [UNODC WDR 2025 West & Central Africa](https://www.unodc.org/westandcentralafrica/en/westandcentralafrica/stories/2025/unodcs-world-drug-report-2025_-global-instability-and-the-diversification-of-drug-markets-in-west-and-central-africa-deepens-health-and-security-risks.html); [UN E/CN.7/2026/6](https://docs.un.org/en/E/CN.7/2026/6?direct=true)
- FTIR spectrometer testing found synthetic cannabinoids and nitazenes in Freetown kush. The tests were carried out with NDLEA authorisation. — [GI-TOC: Kush testing](https://globalinitiative.net/analysis/kush-testing-drug-markets-sierra-leone-guinea-bissau/)
- Nitazenes were found in 83% of Sierra Leone samples (UNODC). GI-TOC reports 87% of field-tested samples. These figures come from different testing efforts. — [UNODC WDR 2025 key findings (PDF)](https://www.unodc.org/documents/data-and-analysis/WDR_2025/WDR25_B1_Key_findings.pdf); [GI-TOC Kush in Sierra Leone](https://globalinitiative.net/analysis/kush-in-sierra-leone/)
- GI-TOC recommends expanding treatment, overdose reversal medication (naloxone) and alternatives to incarceration. — [GI-TOC Kush in Sierra Leone](https://globalinitiative.net/analysis/kush-in-sierra-leone/)
- WENDU (ECOWAS/UNODC, EU-funded) is the regional drug epidemiology network. The 2023 WENDU report was launched in Freetown in Sept 2024 and flagged kush as a public health emergency. — [ECOWAS](https://www.ecowas.int/the-2023-west-african-epidemiology-network-on-drug-use-wendu-report-statistics-and-trends-on-illicit-drug-supply-and-drug-use-officially-released/); [ISSUP](https://issup.net/node/15118)
- An academic review of kush use among youths in Sierra Leone covers its socioeconomic impact. — [Lahai 2025, Public Health Challenges](https://onlinelibrary.wiley.com/doi/10.1002/puh2.70031)

### Inferences
- Dashboards (DHIS2 analytics/maps): new treatment enrolments by substance, district and age; retention and outcomes; relapse; overdose and naloxone events; kush-related deaths (linked to eIDSR or a mortality surveillance event program); hotline call volume. Maps should be aggregated to chiefdom/ward level so individuals cannot be identified.
- Early warning: a DHIS2 event program for "drug sample tested" (FTIR or forensic lab result, substance detected, location aggregated, seizure vs street sample). Alert rules fire when a new substance is detected or overdose clusters exceed a threshold, and trigger a joint MoHS/NDLEA alert and public health messaging. Seizure (supply) data stays in the NDLEA module and only aggregate substance composition is shared.
- Map indicators to WENDU and UNODC Annual Report Questionnaire formats so national data feeds regional reporting automatically.

### Gaps
- Whether UNODC's Early Warning Advisory on NPS has a West Africa or Sierra Leone node was not found.
- Sierra Leone's forensic and toxicology lab capacity and its LIS were not researched.
- No official treatment caseload numbers were found.

## 6. Cost, sustainability, procurement, failures and donor funding

### Takeaway
The literature on donor-funded health IT in Africa shows that most projects fail or become unsustainable when they are donor-driven, focused on technology, fragmented, and not built into ministry routines. The NDLEA's tiny budget (about US$50k reported) means the system must be MoHS-anchored, open-source, built on existing DHIS2 capacity, and co-financed. Identified funding links: UNODC/ECOWAS/EU (WENDU) and the World Bank (ID and energy). Specific Global Fund, INL and WHO funding lines for this purpose were not verified.

### Cited Findings
- Most donor-supported IT projects in less-developed economies end in full or partial failure or become unsustainable. Causes include weak infrastructure and HR capacity, fragmented donor policy, no sustainability policy, and poor relationships between the MoH and donors or developers. Systems last when they are institutionalised into everyday routine. — [PMC5223327 (Tanzania/Mozambique HIS sustainability)](https://pmc.ncbi.nlm.nih.gov/articles/PMC5223327)
- Donor emphasis on technology over user needs weakens HR capacity and design. — [CORE: HIS sustainability](https://core.ac.uk/display/154878836); [PMC5223327](https://pmc.ncbi.nlm.nih.gov/articles/PMC5223327)
- In Malawi, Zambia and Zimbabwe, perceived risks led to hesitancy and parallel paper systems. Full stakeholder engagement and integration with partner-funded activities were judged crucial. — [CORE three-country study](https://core.ac.uk/display/154878836)
- The West Africa Health Informatics Team (USAID-funded, at WAHO) aimed to build local software engineering capacity for HIS sustainability. — [USAID Learning Lab](https://usaidlearninglab.org/node/27099)
- Ebola showed that West African health ICT was inadequate and had to evolve in real time. — [Wilton Park report WP1409 (PDF)](https://test.chwcentral.org/wp-content/uploads/2016/01/WP1409-Report.pdf)
- Sierra Leone had a poorly executed 2018–2023 strategy and no operational roadmap. — [ICTworks](https://www.ictworks.org/updated-every-african-countrys-national-digital-health-strategy-in-2026/); [BMZ mapping](https://www.bmz-digital.global/wp-content/uploads/2024/10/SIERRA-LEONE-Health-Data-Ecosystem-Mapping-DIPC.pdf)
- The NDLEA budget was about US$50k in 2024 and the agency is chronically underfunded. — [Pan African Visions](https://panafricanvisions.com/2025/07/sierra-leones-dilemma-the-deadly-kush-continues-to-ravage-its-citizens/)
- Donor projects in Sierra Leone often end. For example, AIM Health Plus (CommCare) closed in Dec 2022. — [World Vision](https://www.wvi.org/publications/health/2021-digital-health-factsheet-aim-health-plus-sierra-leone)
- WENDU is funded by the EU through ECOWAS/UNODC. — [ThisDay](https://thisdaylive.com/index.php/2019/11/04/unodc-ecowas-eu-release-wendu-report)
- The World Bank supports Sierra Leone's digital ID and the RESPITE energy project (aiming to raise access from 16% to 36%). — [World Bank blog](https://blogs.worldbank.org/en/africacan/unlocking-opportunity-how-digital-id-can-transform-lives-in-sierra-leone); [Energy Institute](https://knowledge.energyinst.org/new-energy-world/article?id=160427)

### Inferences
- Procurement lessons: specify open standards (DHIS2/FHIR); government ownership of code, data and admin credentials; local hosting and support contracts with HISP Sierra Leone or local firms; avoid vendor lock-in and proprietary licences; budget recurrent costs (hosting, SMS/USSD fees, devices, airtime, training, staff) in the MoHS and NDLEA budget lines from year 1; and plan a donor exit before launch.
- Avoid a parallel standalone system. A separate NDLEA "registry" outside DHIS2 would repeat the classic failure pattern.
- Donor angles to approach: UNODC (drug demand reduction, WENDU, treatment standards), the EU (WENDU and drug policy), WHO (mental health and mhGAP, Mental Health Bill support), the World Bank (health and digital and ID projects), and potentially the US INL and Global Fund (harm reduction/HIV overlap). The last two are unverified.

### Gaps
- No named West African government IT failure case study (e.g. a failed e-health or e-ID procurement in Sierra Leone, Liberia or Nigeria) was retrieved.
- No current (2025–2026) funding commitments from UNODC, INL, WHO, Global Fund or EU for Sierra Leone kush treatment or data systems were found. US foreign-assistance cuts in 2025 may affect INL and USAID availability (not researched).
- No cost benchmarks (per-facility DHIS2 Tracker rollout, USSD short code fees in Sierra Leone) were found.

## 7. Recommended phased rollout (Freetown/Western Area pilot, then districts)

### Takeaway
The evidence (concentrated power and connectivity in Freetown, existing DHIS2 capacity, no DP law, punitive sentencing) supports a governance-first, phased rollout. Start with legal and privacy foundations and a Western Area pilot in treatment sites and outreach, then expand by district with offline and solar kits.

### Cited Findings
- About 90% of grid electricity customers are in Freetown. — [Trade.gov](https://trade.gov/country-commercial-guides/sierra-leone-energy-infrastructure)
- Rural electricity access is about 5–6%. — [EBSCO](https://www.ebsco.com/research-starters/power-and-energy/sierra-leones-energy-infrastructure); [Energy Institute](https://knowledge.energyinst.org/new-energy-world/article?id=160427)
- Institutionalisation and stakeholder engagement are what determine sustainability. — [PMC5223327](https://pmc.ncbi.nlm.nih.gov/articles/PMC5223327); [CORE](https://core.ac.uk/display/154878836)
- The DP law is pending and the Mental Health Bill is pending. — see section 2 sources.

### Inferences (proposed phasing, analyst judgement)
- **Phase 0 (0–6 months): governance.** NDLEA–MoHS MoU and data-sharing protocol (aggregate-only to NDLEA); a ministerial directive or SI giving the legal basis; a DPIA; consent scripts; a data governance committee including civil society and people with lived experience; design aligned with the DP Bill; agreement with HISP-SL and the MoHS DHIS2 team; WENDU indicator mapping.
- **Phase 1 (6–18 months): Western Area Urban and Rural pilot.** Sites: Kissy Psychiatric Hospital, government and NGO rehab centres, and 2–3 outreach teams. DHIS2 Tracker treatment/case management program, Android Capture with forced encryption, a toll-free USSD/IVR hotline on Orange and Africell, an early warning event program linked to FTIR testing, and an aggregate NDLEA dashboard. Evaluate uptake, data quality, privacy incidents and whether registration deters service use.
- **Phase 2 (18–36 months): scale to high-burden districts** (e.g. Bo, Kenema, Makeni/Bombali, Port Loko; to be confirmed by WENDU and treatment data), with solar kits, SMS fallback, and training of district M&E staff.
- **Phase 3 (36+ months): national coverage and integration.** NIN/MOSIP linkage via the identity vault, OpenMRS or FHIR link for inpatient units, an LIS link for toxicology, automated WENDU/UNODC reporting, and a full move to government budget.

### Gaps
- District-level kush prevalence data to prioritise Phase 2 districts was not found.
- A current list of treatment/rehabilitation facilities in Sierra Leone was not retrieved.
