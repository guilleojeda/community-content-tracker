import { feedbackUrl, isBetaModeActive } from '@/lib/featureFlags';

export const metadata = {
  title: 'Beta Feedback – AWS Community Content Hub',
};

export default function FeedbackPage() {
  const betaActive = isBetaModeActive();

  if (!betaActive) {
    return (
      <div className="container mx-auto px-4 py-16">
        <div className="max-w-2xl mx-auto bg-white shadow-sm border border-gray-200 rounded-lg p-8 text-center">
          <h1 className="text-3xl font-bold text-gray-900">Feedback Unavailable</h1>
          <p className="mt-4 text-gray-600">
            The beta feedback channel is only accessible in beta environments.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-16">
      <div className="max-w-4xl mx-auto bg-white shadow-sm border border-gray-200 rounded-lg p-8">
        <h1 className="text-3xl font-bold text-gray-900">Share Your Feedback</h1>
        <p className="mt-3 text-gray-600">
          Help us polish the AWS Community Content Hub ahead of the GA launch. Share bugs, usability issues,
          or feature requests via the embedded form below.
        </p>
        <div className="mt-8">
          <iframe
            title="Beta feedback form"
            src={feedbackUrl}
            className="w-full h-[720px] rounded-lg border border-gray-200"
            allow="camera; microphone; autoplay; encrypted-media"
          />
        </div>
      </div>
    </div>
  );
}
