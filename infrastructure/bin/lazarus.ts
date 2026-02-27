#!/usr/bin/env node
// ============================================================================
// LAZARUS — CDK App Entry Point
// ============================================================================

import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { LazarusStack } from '../lib/lazarus-stack';

const app = new cdk.App();

new LazarusStack(app, 'LazarusStack', {
  env: {
    account: process.env['CDK_DEFAULT_ACCOUNT'],
    region: 'ap-south-1',
  },
  description: 'Lazarus — AI-Powered Legacy Code Modernization Platform',
});

app.synth();
