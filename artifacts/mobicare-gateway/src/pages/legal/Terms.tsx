import { Link } from 'wouter';
import { ContactLink, LegalPage, LegalSection } from './LegalPage';

export default function Terms() {
  return (
    <LegalPage
      title="Terms of service"
      intro={
        <p>
          These terms apply when you use MobiCare to find and order medicines. MobiCare is run by MediTrace
          Health Systems Limited in Freetown, Sierra Leone. How we handle your data is in the{' '}
          <Link href="/privacy" className="text-primary font-medium hover:underline">privacy notice</Link>.
        </p>
      }
    >
      <LegalSection title="What MobiCare is">
        <p>
          MobiCare connects patients with licensed pharmacies that MobiCare has verified. The pharmacy you
          order from supplies your medicine and is responsible for it. MobiCare does not give medical advice:
          ask a pharmacist, doctor or nurse about your treatment.
        </p>
      </LegalSection>

      <LegalSection title="Your account">
        <ul>
          <li>You must be 18 or older and give true details, including a phone number you can be reached on.</li>
          <li>Keep your password, and your Google account if you sign in with it, to yourself. Tell us at <ContactLink /> if you think someone else has used your account.</li>
        </ul>
      </LegalSection>

      <LegalSection title="Prescriptions and controlled medicines">
        <ul>
          <li>Prescription medicines need a valid prescription. A pharmacist checks it before the order goes ahead and may refuse it.</li>
          <li>Controlled medicines are collection only, need an identity check in person, and have a limit per order.</li>
          <li>Uploading a false or altered prescription ends your account and may be reported to the authorities.</li>
        </ul>
      </LegalSection>

      <LegalSection title="Prices, fees and payment">
        <ul>
          <li>Each pharmacy sets its own prices.</li>
          <li>During our pilot and launch, MobiCare charges you no service fee: you pay the pharmacy's prices. Delivery has a fee for your area. You see every amount before you pay.</li>
          <li>Pharmacies pay MobiCare a commission on each sale. This never changes the price you see.</li>
          <li>If MobiCare introduces a service fee later, we will update these terms first and show the fee before you pay.</li>
          <li>You pay by mobile money.</li>
        </ul>
      </LegalSection>

      <LegalSection title="Delivery and collection">
        <p>
          Delivery is available only in MobiCare's delivery areas. Give a reachable phone number and clear
          directions. For collection, bring identification when the pharmacy asks for it.
        </p>
      </LegalSection>

      <LegalSection title="Problems with an order">
        <p>
          Contact <ContactLink /> about a missing, wrong or damaged order, or a payment problem. We will work
          with the pharmacy to put it right.
        </p>
      </LegalSection>

      <LegalSection title="Fair use">
        <p>
          Do not misuse MobiCare: no false orders, no attempts to get medicines you are not entitled to, and
          no interference with the service. We may suspend accounts that do.
        </p>
      </LegalSection>

      <LegalSection title="Changes and governing law">
        <p>
          We may update these terms and will change the date at the top when we do. These terms are governed
          by the laws of Sierra Leone.
        </p>
      </LegalSection>
    </LegalPage>
  );
}
