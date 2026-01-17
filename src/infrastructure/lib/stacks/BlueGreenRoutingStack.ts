import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as ssm from 'aws-cdk-lib/aws-ssm';

const CLOUDFRONT_ZONE_ID = 'Z2FDTNDATAQYW2';

export interface BlueGreenRoutingStackProps extends cdk.StackProps {
  environment: string;
  rootDomainName: string;
  hostedZoneId: string;
  hostedZoneName: string;
  blueDistributionDomainParam: string;
  greenDistributionDomainParam: string;
  blueWeight: number;
  greenWeight: number;
}

export class BlueGreenRoutingStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: BlueGreenRoutingStackProps) {
    super(scope, id, props);

    const { blueWeight, greenWeight } = props;
    if (blueWeight < 0 || greenWeight < 0) {
      throw new Error('Blue/green weights must be zero or positive');
    }
    if (blueWeight + greenWeight === 0) {
      throw new Error('Blue/green weights cannot both be zero');
    }

    const hostedZone = route53.HostedZone.fromHostedZoneAttributes(this, 'BlueGreenHostedZone', {
      hostedZoneId: props.hostedZoneId,
      zoneName: props.hostedZoneName,
    });

    const blueDomain = ssm.StringParameter.valueForStringParameter(
      this,
      props.blueDistributionDomainParam
    );
    const greenDomain = ssm.StringParameter.valueForStringParameter(
      this,
      props.greenDistributionDomainParam
    );

    const createWeightedRecord = (suffix: string, weight: number, targetDomain: string) => {
      new route53.CfnRecordSet(this, `BlueGreen${suffix}ARecord`, {
        hostedZoneId: hostedZone.hostedZoneId,
        name: props.rootDomainName,
        type: 'A',
        setIdentifier: suffix.toLowerCase(),
        weight,
        aliasTarget: {
          dnsName: targetDomain,
          hostedZoneId: CLOUDFRONT_ZONE_ID,
          evaluateTargetHealth: false,
        },
      });

      new route53.CfnRecordSet(this, `BlueGreen${suffix}AAAARecord`, {
        hostedZoneId: hostedZone.hostedZoneId,
        name: props.rootDomainName,
        type: 'AAAA',
        setIdentifier: `${suffix.toLowerCase()}-ipv6`,
        weight,
        aliasTarget: {
          dnsName: targetDomain,
          hostedZoneId: CLOUDFRONT_ZONE_ID,
          evaluateTargetHealth: false,
        },
      });
    };

    createWeightedRecord('Blue', blueWeight, blueDomain);
    createWeightedRecord('Green', greenWeight, greenDomain);

    new cdk.CfnOutput(this, 'BlueGreenDomain', {
      value: props.rootDomainName,
      description: 'Root domain name for blue/green routing',
    });

    new cdk.CfnOutput(this, 'BlueWeight', {
      value: String(blueWeight),
      description: 'Weight for blue deployment',
    });

    new cdk.CfnOutput(this, 'GreenWeight', {
      value: String(greenWeight),
      description: 'Weight for green deployment',
    });
  }
}
