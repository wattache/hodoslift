package socle

import (
	"context"

	"buf.build/go/protovalidate"
	"connectrpc.com/connect"
	"google.golang.org/protobuf/proto"
)

// InterceptorValidation applique les règles écrites DANS le contrat
// (`buf.validate`) avant tout métier — l'équivalent du `extra="forbid"` et des
// `Field(min_length=…)` de Pydantic, mais lisibles par le front aussi.
// Refus : invalid_argument, `corps_invalide`, avec le champ et la règle.
func InterceptorValidation() (connect.UnaryInterceptorFunc, error) {
	validateur, err := protovalidate.New()
	if err != nil {
		return nil, err
	}
	return func(next connect.UnaryFunc) connect.UnaryFunc {
		return func(ctx context.Context, req connect.AnyRequest) (connect.AnyResponse, error) {
			if msg, ok := req.Any().(proto.Message); ok {
				if err := validateur.Validate(msg); err != nil {
					return nil, Metier("corps_invalide", err.Error())
				}
			}
			return next(ctx, req)
		}
	}, nil
}
