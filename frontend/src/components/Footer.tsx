/**
 * Names the AWS services. It sits in the page flow below the content; on phones it is
 * small, unboxed and followed by a strip of open ground so it never covers the tombstones.
 */
export function Footer() {
  return (
    <footer className="relative z-10 px-4 pb-[15vh] pt-6 text-center text-[11px] leading-relaxed text-mist [text-shadow:0_1px_3px_rgba(7,8,15,0.95)] sm:pb-3 sm:text-xs">
      <p className="mx-auto max-w-[19rem] sm:inline-block sm:max-w-none sm:rounded-full sm:bg-night-900/55 sm:backdrop-blur-sm sm:shadow-[inset_0_1px_0_rgba(233,236,245,0.08)] sm:px-3 sm:py-1 sm:[text-shadow:none]">
        Built on AWS · Lambda · CodeBuild · S3 · CloudFront · DynamoDB · Bedrock · EventBridge
      </p>
    </footer>
  )
}
