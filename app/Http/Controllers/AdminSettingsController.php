<?php

declare(strict_types=1);

namespace JDR\Http\Controllers;

defined('JDR_BOOT') || exit;

use JDR\Core\Request;
use JDR\Core\Response;
use JDR\Domain\Audit\AuditLog;
use JDR\Domain\Auth\CurrentUser;
use JDR\Domain\Settings\SettingsService;
use JDR\Domain\Support\Validator;
use JDR\Mail\Mailer;
use JDR\Mail\SmtpLogException;

/**
 * /admin/settings (routes with role=admin).
 */
final class AdminSettingsController
{
    public function __construct(
        private SettingsService $settings,
        private Mailer $mailer,
        private AuditLog $audit,
    ) {
    }

    public function show(Request $request): Response
    {
        return Response::ok(['settings' => $this->settings->view()]);
    }

    /**
     * PATCH /admin/settings: partial settings, either at the top level or under "settings".
     */
    public function update(Request $request): Response
    {
        $body = $request->parsedBody();
        $body = is_array($body) ? $body : [];
        if (isset($body['settings']) && is_array($body['settings']) && count($body) === 1) {
            $body = $body['settings'];
        }
        $view = $this->settings->update($body, CurrentUser::require($request), $request->ip());

        return Response::ok(['settings' => $view]);
    }

    /**
     * POST /admin/settings/smtp-test {to} -> {sent, log}
     */
    public function smtpTest(Request $request): Response
    {
        $admin = CurrentUser::require($request);
        $v = Validator::fromRequest($request);
        $to = (string) $v->email('to');
        $v->validate();
        if (!$this->mailer->isEnabled()) {
            return Response::ok(['sent' => false, 'log' => ['SMTP is not configured (host and sender required).']]);
        }
        try {
            $log = $this->mailer->send($to, 'JDR — test SMTP', "Ce message de test confirme que l'envoi d'e-mails fonctionne.");
            $sent = true;
        } catch (SmtpLogException $e) {
            $log = $e->log();
            $sent = false;
        } catch (\RuntimeException $e) {
            $log = [$e->getMessage()];
            $sent = false;
        }
        $this->audit->record($admin->id, 'smtp.test', 'settings', null, ['sent' => $sent], $request->ip());

        return Response::ok(['sent' => $sent, 'log' => $log]);
    }
}
