export default function TermsPage() {
  return (
    <div className="mx-auto max-w-5xl px-6 py-12 space-y-8">
      <header>
        <h1 className="text-4xl font-bold text-gray-900">Terms of Service</h1>
        <p className="mt-2 text-gray-600">
          These terms govern your access to and use of the AWS Community Content Hub. By creating an account you agree to
          these conditions.
        </p>
      </header>

      <section className="space-y-3">
        <h2 className="text-2xl font-semibold text-gray-900">User obligations</h2>
        <p className="text-gray-700">
          You are responsible for the accuracy of the content you submit, maintaining the confidentiality of your login
          credentials, and complying with all applicable laws and AWS community guidelines.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-2xl font-semibold text-gray-900">Acceptable use</h2>
        <p className="text-gray-700">
          Do not upload malicious code, attempt unauthorized access, or misuse data belonging to other community
          members. We reserve the right to suspend accounts that violate these rules.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-2xl font-semibold text-gray-900">Limitation of liability</h2>
        <p className="text-gray-700">
          The service is provided on an &ldquo;as is&rdquo; basis. To the fullest extent permitted by law we disclaim liability
          for any indirect or consequential damages arising from the use of the platform.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-2xl font-semibold text-gray-900">Changes</h2>
        <p className="text-gray-700">
          We may update these terms to reflect product changes or legal requirements. Continued use after an update means
          you accept the revised terms. Significant changes will be announced through the dashboard and email.
        </p>
      </section>
    </div>
  );
}
