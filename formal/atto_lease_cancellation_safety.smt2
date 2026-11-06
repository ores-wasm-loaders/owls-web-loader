; OWLS shared speculative preparation lease: last owner releases source.
; UNSAT: cancellation never occurs with another owner still present.
; SAT mutation: unconditional cancellation on any release.
(set-logic QF_LIA)
(declare-const owners_before Int)
(declare-const owners_after Int)
(declare-const released Int)
(declare-const cancel Bool)
(define-fun bounded () Bool
  (and (<= 1 owners_before) (<= owners_before 3)
       (= released 1)
       (= owners_after (- owners_before released))))
(define-fun valid_transition () Bool
  (and bounded
       (= cancel (= owners_after 0))))
(define-fun no_peer_cancellation () Bool
  (or (= owners_after 0) (not cancel)))
(push 1)
(assert valid_transition)
(assert (not no_peer_cancellation))
(check-sat)
(pop 1)
(push 1)
(assert bounded)
(assert (= cancel true))
(assert (> owners_after 0))
(check-sat)
(pop 1)
