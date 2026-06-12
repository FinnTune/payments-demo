import { Duration, Stack, StackProps } from 'aws-cdk-lib';
import {
  Alarm,
  ComparisonOperator,
  Dashboard,
  GraphWidget,
  Metric,
  TreatMissingData,
} from 'aws-cdk-lib/aws-cloudwatch';
import { SnsAction } from 'aws-cdk-lib/aws-cloudwatch-actions';
import { DatabaseInstance } from 'aws-cdk-lib/aws-rds';
import {
  ApplicationLoadBalancer,
  ApplicationTargetGroup,
} from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import { Topic } from 'aws-cdk-lib/aws-sns';
import { Construct } from 'constructs';

interface ObservabilityStackProps extends StackProps {
  database: DatabaseInstance;
  loadBalancer: ApplicationLoadBalancer;
  targetGroup: ApplicationTargetGroup;
}

/**
 * CloudWatch dashboards and alarms.
 *
 * Five alarms wired to one SNS topic; topic has no subscriptions in
 * this demo. Real production would subscribe PagerDuty (for paging
 * 24/7 critical pages), an email distribution list (for FYI alerts),
 * and a Slack webhook (for visibility without paging).
 */
export class ObservabilityStack extends Stack {
  constructor(scope: Construct, id: string, props: ObservabilityStackProps) {
    super(scope, id, props);

    // ---------- SNS topic for alarms ----------
    const alarmTopic = new Topic(this, 'AlarmTopic', {
      topicName: 'payments-alarms',
      displayName: 'Payments alarms',
    });

    // ---------- ALB metrics ----------
    const alb5xxCount = new Metric({
      namespace: 'AWS/ApplicationELB',
      metricName: 'HTTPCode_ELB_5XX_Count',
      dimensionsMap: {
        LoadBalancer: props.loadBalancer.loadBalancerFullName,
      },
      statistic: 'sum',
      period: Duration.minutes(5),
    });

    const targetUnhealthy = new Metric({
      namespace: 'AWS/ApplicationELB',
      metricName: 'UnHealthyHostCount',
      dimensionsMap: {
        LoadBalancer: props.loadBalancer.loadBalancerFullName,
        TargetGroup: props.targetGroup.targetGroupFullName,
      },
      statistic: 'max',
      period: Duration.minutes(1),
    });

    // ---------- RDS metrics ----------
    const dbCpu = props.database.metricCPUUtilization({
      period: Duration.minutes(5),
    });

    const dbFreeStorage = props.database.metricFreeStorageSpace({
      period: Duration.minutes(5),
    });

    // ---------- Alarms ----------
    const alarm5xx = new Alarm(this, 'Alb5xxAlarm', {
      metric: alb5xxCount,
      threshold: 10,                          // 10+ 5xx in 5 minutes
      evaluationPeriods: 1,
      comparisonOperator: ComparisonOperator.GREATER_THAN_THRESHOLD,
      alarmDescription: 'ALB returning 5xx — likely backend failures',
      treatMissingData: TreatMissingData.NOT_BREACHING,
    });
    alarm5xx.addAlarmAction(new SnsAction(alarmTopic));

    const alarmUnhealthy = new Alarm(this, 'TargetUnhealthyAlarm', {
      metric: targetUnhealthy,
      threshold: 1,
      evaluationPeriods: 3,                   // sustained for 3 minutes
      comparisonOperator: ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      alarmDescription: 'ALB target failing health checks',
      treatMissingData: TreatMissingData.NOT_BREACHING,
    });
    alarmUnhealthy.addAlarmAction(new SnsAction(alarmTopic));

    const alarmDbCpu = new Alarm(this, 'DbCpuAlarm', {
      metric: dbCpu,
      threshold: 80,
      evaluationPeriods: 3,
      comparisonOperator: ComparisonOperator.GREATER_THAN_THRESHOLD,
      alarmDescription: 'Database CPU above 80% for 15 minutes',
      treatMissingData: TreatMissingData.NOT_BREACHING,
    });
    alarmDbCpu.addAlarmAction(new SnsAction(alarmTopic));

    const alarmDbStorage = new Alarm(this, 'DbStorageAlarm', {
      metric: dbFreeStorage,
      threshold: 2 * 1024 * 1024 * 1024,      // 2 GB free remaining
      evaluationPeriods: 1,
      comparisonOperator: ComparisonOperator.LESS_THAN_THRESHOLD,
      alarmDescription: 'Database free storage below 2 GB',
      treatMissingData: TreatMissingData.NOT_BREACHING,
    });
    alarmDbStorage.addAlarmAction(new SnsAction(alarmTopic));

    // ---------- Dashboard ----------
    const dashboard = new Dashboard(this, 'PaymentsDashboard', {
      dashboardName: 'payments-service',
    });

    dashboard.addWidgets(
      new GraphWidget({
        title: 'ALB Requests & Errors',
        left: [
          new Metric({
            namespace: 'AWS/ApplicationELB',
            metricName: 'RequestCount',
            dimensionsMap: { LoadBalancer: props.loadBalancer.loadBalancerFullName },
            statistic: 'sum',
            period: Duration.minutes(5),
          }),
        ],
        right: [alb5xxCount, targetUnhealthy],
        width: 12,
      }),
      new GraphWidget({
        title: 'Database',
        left: [dbCpu],
        right: [dbFreeStorage],
        width: 12,
      }),
    );
  }
}