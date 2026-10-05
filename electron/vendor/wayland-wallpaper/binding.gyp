{
  "targets": [
    {
      "target_name": "wayland_layer_shell",
      "type": "none",
      "conditions": [
        [
          "OS==\"linux\"",
          {
            "type": "loadable_module",
            "product_extension": "node",
            "sources": [
              "native/src/layer_shell.cc",
              "native/generated/linux-dmabuf-v1-protocol.c",
              "native/generated/wlr-layer-shell-unstable-v1-protocol.c"
            ],
            "include_dirs": [
              "<!@(node -p \"require('node-addon-api').include\")",
              "native/generated"
            ],
            "dependencies": [
              "<!(node -p \"require('node-addon-api').gyp\")"
            ],
            "defines": [
              "NAPI_CPP_EXCEPTIONS",
              "_GNU_SOURCE"
            ],
            "cflags!": [
              "-fno-exceptions"
            ],
            "cflags_cc!": [
              "-fno-exceptions"
            ],
            "cflags_cc": [
              "-std=c++17"
            ],
            "libraries": [
              "-lwayland-client",
              "-pthread"
            ]
          }
        ]
      ]
    }
  ]
}
