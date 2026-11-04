/**
 * Names the AWS services. It sits in the page flow below the content; on phones it is
 * small, unboxed and followed by a strip of open ground so it never covers the tombstones.
 */
export function Footer() {
  return (
    <footer className="relative z-10 px-4 pb-[15vh] pt-6 text-center text-[11px] leading-relaxed text-mist [text-shadow:0_1px_2px_rgba(0,0,0,0.9)] sm:pb-3 sm:text-xs">
      <p className="mx-auto max-w-[19rem] sm:inline-block sm:max-w-none sm:rounded-full sm:bg-night-950/80 sm:px-3 sm:py-1 sm:[text-shadow:none]">
        Built on AWS · Lambda · CodeBuild · S3 · CloudFront · DynamoDB · Bedrock · EventBridge
      </p>
    </footer>
  )
}
