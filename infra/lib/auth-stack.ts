import { CfnOutput, Duration, RemovalPolicy, Stack, StackProps } from 'aws-cdk-lib';
import {
  AccountRecovery,
  Mfa,
  OAuthScope,
  ResourceServerScope,
  UserPool,
  UserPoolClient,
  UserPoolDomain,
  UserPoolEmail,
  UserPoolResourceServer,
  VerificationEmailStyle,
} from 'aws-cdk-lib/aws-cognito';
import { Construct } from 'constructs';

/**
 * Cognito user pool + resource server.
 *
 * Provides the OAuth2 issuer the backend's @PreAuthorize annotations
 * need. The resource server "payments-api" declares two scopes
 * (read, write); a user pool client is allowed to request both.
 *
 * The backend's SecurityConfig will be wired to this issuer's JWKs
 * URL (commit 26), at which point the @PreAuthorize annotations
 * activate end-to-end.
 */
export class AuthStack extends Stack {
  public readonly userPool: UserPool;
  public readonly userPoolClient: UserPoolClient;
  public readonly issuerUrl: string;

  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    // ---------- User Pool ----------
    this.userPool = new UserPool(this, 'PaymentsUserPool', {
      userPoolName: 'payments-users',

      // Self-service sign-up disabled for an internal API; admins create
      // users via the AWS console or a separate admin tool. Flip this if
      // you want public registration.
      selfSignUpEnabled: false,

      signInAliases: { email: true, username: false },
      autoVerify: { email: true },
      standardAttributes: {
        email: { required: true, mutable: false },
      },

      passwordPolicy: {
        minLength: 12,
        requireLowercase: true,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: true,
        tempPasswordValidity: Duration.days(3),
      },

      mfa: Mfa.OPTIONAL,
      mfaSecondFactor: { sms: false, otp: true },  // TOTP only

      accountRecovery: AccountRecovery.EMAIL_ONLY,
      email: UserPoolEmail.withCognito(),
      userVerification: {
        emailStyle: VerificationEmailStyle.CODE,
        emailSubject: 'Verify your payments-demo account',
        emailBody:
          'Your verification code is {####}. ' +
          'It expires in 24 hours.',
      },

      // RemovalPolicy.DESTROY is fine for a demo. In production you'd
      // use RETAIN so an accidental 'cdk destroy' doesn't nuke every
      // user account.
      removalPolicy: RemovalPolicy.DESTROY,
    });

    // ---------- Resource Server ----------
    // Declares the API and its scopes. The backend will validate
    // against these.
    const readScope = new ResourceServerScope({
      scopeName: 'read',
      scopeDescription: 'Read access to payments',
    });
    const writeScope = new ResourceServerScope({
      scopeName: 'write',
      scopeDescription: 'Create and modify payments',
    });

    const resourceServer = new UserPoolResourceServer(this, 'PaymentsResourceServer', {
      userPool: this.userPool,
      identifier: 'payments',
      userPoolResourceServerName: 'Payments API',
      scopes: [readScope, writeScope],
    });

    // ---------- App Client (the SPA) ----------
    // The React app uses this client to perform the OAuth2
    // Authorization Code flow with PKCE.
    this.userPoolClient = new UserPoolClient(this, 'PaymentsAppClient', {
      userPool: this.userPool,
      userPoolClientName: 'payments-spa',

      generateSecret: false,                    // SPAs can't keep secrets

      oAuth: {
        flows: {
          authorizationCodeGrant: true,         // PKCE-able flow
          implicitCodeGrant: false,             // legacy, insecure
          clientCredentials: false,             // SPAs use a real user
        },
        scopes: [
          OAuthScope.OPENID,
          OAuthScope.EMAIL,
          OAuthScope.PROFILE,
          OAuthScope.resourceServer(resourceServer, readScope),
          OAuthScope.resourceServer(resourceServer, writeScope),
        ],
        callbackUrls: [
          'http://localhost:5173/auth/callback',  // dev
          // Production callback added when we know the CloudFront domain.
        ],
        logoutUrls: [
          'http://localhost:5173',
        ],
      },

      accessTokenValidity: Duration.minutes(60),
      idTokenValidity: Duration.minutes(60),
      refreshTokenValidity: Duration.days(30),
      preventUserExistenceErrors: true,
    });

    // ---------- Hosted UI Domain ----------
    // Cognito-hosted login screen at payments-<account>.auth.<region>.amazoncognito.com.
    // For production you'd use a custom domain (auth.payments.example.com)
    // with an ACM cert.
    new UserPoolDomain(this, 'PaymentsAuthDomain', {
      userPool: this.userPool,
      cognitoDomain: {
        domainPrefix: `payments-${this.account}`,
      },
    });

    // ---------- Outputs ----------
    // Other stacks (and the backend's config) need these values.
    this.issuerUrl = `https://cognito-idp.${this.region}.amazonaws.com/${this.userPool.userPoolId}`;

    new CfnOutput(this, 'UserPoolId',     { value: this.userPool.userPoolId });
    new CfnOutput(this, 'UserPoolClientId', { value: this.userPoolClient.userPoolClientId });
    new CfnOutput(this, 'IssuerUrl',      { value: this.issuerUrl });
  }
}