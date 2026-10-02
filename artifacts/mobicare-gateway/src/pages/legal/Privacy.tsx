import { ContactLink, LegalPage, LegalSection } from './LegalPage';

export default function Privacy() {
  return (
    <LegalPage
      title="Privacy notice"
      intro={
        <p>
          MobiCare holds your details, prescriptions and orders so a licensed pharmacy can supply your
          medicine safely. We never sell your personal data. MobiCare is run by MediTrace Health Systems
          Limited in Freetown, Sierra Leone. Questions about your data: <ContactLink />.
        </p>
      }
    >
      <LegalSection title="What we hold">
        <ul>
          <li><strong>Your account:</strong> name, phone number, date of birth, and, if you add them, email, address, national ID number, nationality and a profile photo.</li>
          <li><strong>If you sign in with Google:</strong> your Google account ID, name and email address. Google never gives us your Google password.</li>
          <li><strong>Prescriptions:</strong> photos you upload, and the pharmacist's decision on each.</li>
          <li><strong>Orders:</strong> the medicines, the pharmacy, prices and fees, how you paid, and for delivery the location and directions you give.</li>
          <li><strong>Searches:</strong> only if you agree to help improve medicine access. HQ sees them only as totals across many patients, never by name.</li>
          <li><strong>Security records:</strong> which devices are signed in, and a log of important actions.</li>
        </ul>
      </LegalSection>

      <LegalSection title="Why we hold it">
        <ul>
          <li>To run your account and your orders, including delivery and collection.</li>
          <li>So a pharmacist can check your prescription before any prescription medicine is supplied.</li>
          <li>For controlled medicines: to apply per-order limits and the identity check at collection.</li>
          <li>To keep the dispensing and payment records pharmacies and MobiCare must keep.</li>
          <li>To keep accounts secure and investigate misuse.</li>
          <li>With your permission only: anonymous figures on which medicines are hard to find, and where.</li>
        </ul>
      </LegalSection>

      <LegalSection title="Who sees it">
        <ul>
          <li><strong>The pharmacy you order from:</strong> what it needs to supply your order: your name, phone number, the order, your prescription and delivery details.</li>
          <li><strong>The courier:</strong> your name, phone number and delivery location.</li>
          <li><strong>MobiCare HQ staff:</strong> to oversee orders, pharmacies and payments. Their access is recorded.</li>
          <li><strong>Service providers</strong> that run parts of MobiCare for us: hosting and database, text messages and mobile money. They may store data outside Sierra Leone.</li>
          <li><strong>Google,</strong> only if you choose to sign in with Google.</li>
          <li><strong>The Pharmacy Board or other authorities,</strong> only when the law requires it.</li>
        </ul>
      </LegalSection>

      <LegalSection title="How long we keep it">
        <p>
          Your account stays until you delete it. When you delete it, we remove your details, searches,
          notifications and unused prescription photos. Orders and the prescriptions reviewed for them are
          kept without your name, because a pharmacy must keep a record of what it dispensed.
        </p>
      </LegalSection>

      <LegalSection title="Your choices">
        <ul>
          <li>Download everything we hold about you: Profile, then Your data.</li>
          <li>Turn the optional search figures on or off at any time in the same place.</li>
          <li>Correct your details in your Profile.</li>
          <li>Delete your account from your Profile. This cannot be undone.</li>
        </ul>
      </LegalSection>

      <LegalSection title="How we protect it">
        <p>
          Connections are encrypted. Passwords are stored only in scrambled form. Prescription photos are
          private and open only through links that expire after a few minutes, and every view is recorded.
        </p>
      </LegalSection>

      <LegalSection title="Age">
        <p>You must be 18 or older to have a MobiCare account.</p>
      </LegalSection>

      <LegalSection title="Changes">
        <p>
          If we change this notice we will update the date at the top and, for important changes, tell you in
          the app first.
        </p>
      </LegalSection>
    </LegalPage>
  );
}
