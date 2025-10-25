export default function PrivacyPolicyPage() {
  return (
    <div className="mx-auto max-w-5xl px-6 py-12 space-y-8">
      <header>
        <h1 className="text-4xl font-bold text-gray-900">Privacy Policy</h1>
        <p className="mt-2 text-gray-600">
          Last updated on {new Date().getFullYear()}-01-01 — We take the privacy of the AWS community seriously and are
          committed to compliance with GDPR and other global regulations.
        </p>
      </header>

      <section className="space-y-3">
        <h2 className="text-2xl font-semibold text-gray-900">What data we collect</h2>
        <p className="text-gray-700">
          We collect profile information, community content metadata, analytics events, and authentication identifiers
          required to operate the AWS Community Content Hub. We never sell personal information and we minimize the data
          we retain to what is necessary to deliver the service.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-2xl font-semibold text-gray-900">Data retention</h2>
        <p className="text-gray-700">
          Contribution analytics are retained for 24 months to power historical insights. Audit logs are preserved for
          seven years to satisfy security and compliance requirements. You may request deletion at any time and core
          account data will be erased immediately following verification.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-2xl font-semibold text-gray-900">Your rights</h2>
        <ul className="list-disc pl-6 text-gray-700 space-y-1">
          <li>Access and export all personal data through the dashboard.</li>
          <li>Rectify inaccurate information, including email preferences and social profiles.</li>
          <li>Request erasure which permanently removes your account and associated content.</li>
        </ul>
      </section>

      <section className="space-y-3">
        <h2 className="text-2xl font-semibold text-gray-900">Contact</h2>
        <p className="text-gray-700">
          If you have questions about this policy or would like to exercise your rights, email
          privacy@awscommunityhub.org. We respond to all requests within 30 days.
        </p>
      </section>
    </div>
  );
}
