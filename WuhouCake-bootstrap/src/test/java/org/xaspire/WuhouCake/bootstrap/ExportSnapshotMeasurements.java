package org.xaspire.WuhouCake.bootstrap;

import java.sql.Connection;
import java.util.Queue;
import java.util.concurrent.ConcurrentLinkedQueue;
import org.apache.ibatis.executor.statement.StatementHandler;
import org.apache.ibatis.plugin.*;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

/** Counts prepared statements from first SQL through snapshot transaction completion. */
@Intercepts(@Signature(type = StatementHandler.class, method = "prepare", args = {Connection.class, Integer.class}))
final class ExportSnapshotMeasurements implements Interceptor {
    record Sample(int statements, long elapsed) { }
    private static final String SERVICE =
            "org.xaspire.WuhouCake.order.application.service.OrderExportSnapshotService.";
    final Queue<Sample> samples = new ConcurrentLinkedQueue<>();

    @Override public Object intercept(Invocation invocation) throws Throwable {
        String name = TransactionSynchronizationManager.getCurrentTransactionName();
        if (name != null && name.startsWith(SERVICE)) {
            var transaction = (Capture) TransactionSynchronizationManager.getResource(this);
            if (transaction == null) {
                transaction = new Capture();
                TransactionSynchronizationManager.bindResource(this, transaction);
                TransactionSynchronizationManager.registerSynchronization(transaction);
            }
            transaction.statements++;
        }
        return invocation.proceed();
    }

    private final class Capture implements TransactionSynchronization {
        private final long started = System.nanoTime();
        private int statements;

        @Override public void afterCompletion(int status) {
            TransactionSynchronizationManager.unbindResource(ExportSnapshotMeasurements.this);
            if (status == STATUS_COMMITTED) samples.add(new Sample(statements, System.nanoTime() - started));
        }
    }
}
