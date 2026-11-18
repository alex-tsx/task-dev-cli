export function report({ name = '@example/sdk', version = '1.2.3-1234.1', range = '^1.2.3', requester = '@example/rest' } = {}) {
  return `npm error code ERESOLVE
npm error ERESOLVE unable to resolve dependency tree
npm error Found: ${name}@${version}
npm error node_modules/${name}
npm error Could not resolve dependency:
npm error peer ${name}@"${range}" from ${requester}@4.1.1
npm error node_modules/${requester}
`;
}
