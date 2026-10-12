import { describe, expect, it } from 'vitest';
import { authorization, sha256Hex } from './sigv4';

// The AWS SigV4 test suite (awslabs/aws-c-auth tests/aws-signing-test-suite/v4), its shared credentials and time.
const SUITE = { accessKeyId: 'AKIDEXAMPLE', secretAccessKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY', region: 'us-east-1', service: 'service' };
const DATE = '20150830T123600Z';
const headers = { Host: 'example.amazonaws.com', 'X-Amz-Date': DATE };

describe('sigv4', () => {
  it('signs the suite’s get-vanilla and get-vanilla-query-order-key-case requests', () => {
    expect(authorization(SUITE, 'GET', new URL('https://example.amazonaws.com/'), headers, sha256Hex(''), DATE)).toBe(
      'AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/service/aws4_request, SignedHeaders=host;x-amz-date, Signature=5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31',
    );
    expect(authorization(SUITE, 'GET', new URL('https://example.amazonaws.com/?Param2=value2&Param1=value1'), headers, sha256Hex(''), DATE)).toBe(
      'AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/service/aws4_request, SignedHeaders=host;x-amz-date, Signature=b97d918cfa904a5beff61c982a1b6f458b799221646efd99d3219ec94cdf2500',
    );
  });
});
