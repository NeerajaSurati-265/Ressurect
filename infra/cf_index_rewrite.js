// CloudFront Function (cloudfront-js-2.0), viewer-request on the graves distribution.
// "/r-abc/"            -> "/r-abc/index.html"
// "/r-abc"             -> "/r-abc/index.html"
// "/r-abc/about"       -> "/r-abc/about/index.html"
// "/r-abc/assets/x.js" -> unchanged (last segment has a dot)
function handler(event) {
  var request = event.request;
  var uri = request.uri;

  if (uri.endsWith('/')) {
    request.uri = uri + 'index.html';
  } else {
    var lastSegment = uri.substring(uri.lastIndexOf('/') + 1);
    if (lastSegment.indexOf('.') === -1) {
      request.uri = uri + '/index.html';
    }
  }

  return request;
}
