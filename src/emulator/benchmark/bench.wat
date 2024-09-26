(module
  (func $benchmark (export "benchmark")
    (local $i i32)
    (loop $loop
      (local.set $i (i32.add (local.get $i) (i32.const 1)))
      (i32.eq (local.get $i) (i32.const 10000))
      br_if $loop
    )
  )
)
